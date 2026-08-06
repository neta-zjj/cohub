package filewatch

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Change struct {
	Path     string `json:"path,omitempty"`
	OldPath  string `json:"oldPath,omitempty"`
	Kind     string `json:"kind"`
	NodeType string `json:"nodeType,omitempty"`
	MtimeMs  int64  `json:"mtimeMs,omitempty"`
	Size     int64  `json:"size,omitempty"`
}

type Batch struct {
	Seq     int64    `json:"seq"`
	Resync  bool     `json:"resync,omitempty"`
	Changes []Change `json:"changes"`
}

type Handler func(Batch)

const (
	debounceWindow = 250 * time.Millisecond
	maxBatchSize   = 500
	repairInterval = 5 * time.Minute
)

var defaultIgnore = []string{
	// VCS metadata
	".git", ".hg", ".svn",

	// Dependencies / package manager stores
	"node_modules", ".pnpm-store", ".yarn", ".bun", "vendor",

	// Build outputs
	"dist", "build", "out", "target", ".next", ".nuxt", ".svelte-kit", ".vite", ".vercel", ".output",

	// Cache / coverage / logs / temporary files
	"coverage", ".cache", ".turbo", ".parcel-cache", ".rollup.cache", ".pytest_cache", "__pycache__", ".mypy_cache", ".ruff_cache", "tmp", "temp", ".tmp",
}

type Watcher struct {
	root    string
	logger  *slog.Logger
	handler Handler
	watcher *fsnotify.Watcher

	mu      sync.Mutex
	pending map[string]Change
	resync  bool
	seq     int64
	timer   *time.Timer
	ignored []string
	closed  chan struct{}
}

func Start(root string, logger *slog.Logger, handler Handler) (*Watcher, error) {
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	w := &Watcher{
		root:    filepath.Clean(root),
		logger:  logger,
		handler: handler,
		watcher: fw,
		pending: make(map[string]Change),
		ignored: buildIgnoreList(),
		closed:  make(chan struct{}),
	}
	go w.loop()
	go w.repairLoop()
	go func() {
		w.addRecursiveBestEffort(w.root)
		// Watch start may have missed bootstrap writes. Ask clients to resync once.
		time.Sleep(1 * time.Second)
		w.enqueueResync()
	}()
	return w, nil
}

func buildIgnoreList() []string {
	items := make([]string, 0, len(defaultIgnore)+8)
	seen := make(map[string]struct{}, len(defaultIgnore)+8)
	appendItem := func(raw string) {
		if v := sanitizeIgnorePattern(raw); v != "" {
			if _, ok := seen[v]; ok {
				return
			}
			seen[v] = struct{}{}
			items = append(items, v)
		}
	}
	for _, raw := range defaultIgnore {
		appendItem(raw)
	}
	for _, raw := range strings.Split(os.Getenv("FS_WATCH_IGNORE"), ",") {
		appendItem(raw)
	}
	return items
}

func sanitizeIgnorePattern(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" || strings.Contains(v, "\x00") || filepath.IsAbs(v) {
		return ""
	}
	v = strings.Trim(strings.ReplaceAll(v, "\\", "/"), "/")
	if v == "" || strings.Contains(v, "..") {
		return ""
	}
	return v
}

func (w *Watcher) Close() error {
	close(w.closed)
	w.mu.Lock()
	if w.timer != nil {
		w.timer.Stop()
	}
	w.mu.Unlock()
	return w.watcher.Close()
}

// RequestResync asks consumers to reload authoritative filesystem state.
// It is safe to call when a transport reconnects or watcher coverage is repaired.
func (w *Watcher) RequestResync() {
	w.enqueueResync()
}

func (w *Watcher) loop() {
	for {
		select {
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(event)
		case err, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
			w.logger.Warn("file watcher error", slog.String("error", err.Error()))
			if errors.Is(err, fsnotify.ErrEventOverflow) {
				w.addRecursiveBestEffort(w.root)
				w.enqueueResync()
			}
		case <-w.closed:
			return
		}
	}
}

func (w *Watcher) repairLoop() {
	ticker := time.NewTicker(repairInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if added := w.addRecursiveBestEffort(w.root); added {
				w.enqueueResync()
			}
		case <-w.closed:
			return
		}
	}
}

func (w *Watcher) handleEvent(event fsnotify.Event) {
	rel, ok := w.relative(event.Name)
	if !ok || w.isIgnored(rel) {
		return
	}

	kind := "modify"
	if event.Has(fsnotify.Create) {
		kind = "create"
	} else if event.Has(fsnotify.Remove) {
		kind = "delete"
	} else if event.Has(fsnotify.Rename) {
		kind = "delete"
	}

	nodeType := "unknown"
	var size int64
	var mtimeMs int64
	discoverSubtree := false
	if info, err := os.Lstat(event.Name); err == nil {
		if info.IsDir() {
			nodeType = "dir"
			if event.Has(fsnotify.Create) {
				discoverSubtree = true
			}
		} else {
			nodeType = "file"
		}
		size = info.Size()
		mtimeMs = info.ModTime().UnixMilli()
	}

	w.enqueue(Change{Path: rel, Kind: kind, NodeType: nodeType, Size: size, MtimeMs: mtimeMs})
	if discoverSubtree {
		// Keep the fsnotify loop responsive while a copied or extracted subtree
		// is scanned. enqueue is synchronized and switches to resync at the cap.
		go w.discoverAndWatchSubtree(event.Name, w.enqueue)
	}
}

// addRecursiveBestEffort registers every visible directory below root and
// reports whether watcher coverage expanded. It deliberately emits no changes.
func (w *Watcher) addRecursiveBestEffort(root string) bool {
	known := make(map[string]struct{})
	for _, path := range w.watcher.WatchList() {
		known[filepath.Clean(path)] = struct{}{}
	}
	added := false
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d == nil || !d.IsDir() {
			return nil
		}
		rel, ok := w.relative(path)
		if ok && rel != "" && w.isIgnored(rel) {
			return filepath.SkipDir
		}
		cleaned := filepath.Clean(path)
		_, wasKnown := known[cleaned]
		if err := w.watcher.Add(path); err != nil && !os.IsNotExist(err) {
			w.logger.Debug("failed to add file watcher", slog.String("path", path), slog.String("error", err.Error()))
		} else if err == nil && !wasKnown {
			known[cleaned] = struct{}{}
			added = true
		}
		return nil
	})
	return added
}

// discoverAndWatchSubtree closes the recursive inotify race. It streams
// existing descendants to emit while registering each directory before reading
// its children. Once emit reaches its cap, the walk keeps only watcher coverage;
// the queued resync supplies authoritative state without unbounded allocations.
func (w *Watcher) discoverAndWatchSubtree(root string, emit func(Change) bool) {
	cleanedRoot := filepath.Clean(root)
	emitting := true
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d == nil {
			return nil
		}
		rel, ok := w.relative(path)
		if !ok {
			return nil
		}
		if rel != "" && w.isIgnored(rel) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if err := w.watcher.Add(path); err != nil && !os.IsNotExist(err) {
				w.logger.Debug("failed to add file watcher", slog.String("path", path), slog.String("error", err.Error()))
			}
		}
		if filepath.Clean(path) == cleanedRoot {
			return nil
		}
		if !emitting {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		nodeType := "file"
		if info.IsDir() {
			nodeType = "dir"
		} else if info.Mode()&os.ModeSymlink != 0 {
			nodeType = "unknown"
		}
		emitting = emit(Change{
			Path:     rel,
			Kind:     "create",
			NodeType: nodeType,
			Size:     info.Size(),
			MtimeMs:  info.ModTime().UnixMilli(),
		})
		return nil
	})
}

func (w *Watcher) relative(path string) (string, bool) {
	rel, err := filepath.Rel(w.root, filepath.Clean(path))
	if err != nil || rel == ".." || strings.HasPrefix(rel, "../") || filepath.IsAbs(rel) {
		return "", false
	}
	if rel == "." {
		return "", true
	}
	return filepath.ToSlash(rel), true
}

func (w *Watcher) isIgnored(rel string) bool {
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return false
	}
	segments := strings.Split(rel, "/")
	for _, item := range w.ignored {
		item = strings.Trim(item, "/")
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			if rel == item || strings.HasPrefix(rel, item+"/") {
				return true
			}
			continue
		}
		for _, segment := range segments {
			if segment == item {
				return true
			}
		}
	}
	return false
}

// enqueue returns false once callers should stop materializing individual
// changes and rely on the queued resync instead.
func (w *Watcher) enqueue(change Change) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.resync {
		w.ensureTimerLocked()
		return false
	}
	previous, exists := w.pending[change.Path]
	if !exists && len(w.pending) >= maxBatchSize {
		w.pending = make(map[string]Change)
		w.resync = true
		w.ensureTimerLocked()
		return false
	}
	if exists {
		change = mergeChange(previous, change)
	}
	w.pending[change.Path] = change
	w.ensureTimerLocked()
	return true
}

func (w *Watcher) enqueueResync() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.pending = make(map[string]Change)
	w.resync = true
	w.ensureTimerLocked()
}

func (w *Watcher) ensureTimerLocked() {
	if w.timer != nil {
		return
	}
	w.timer = time.AfterFunc(debounceWindow, w.flush)
}

func (w *Watcher) flush() {
	w.mu.Lock()
	changes := make([]Change, 0, len(w.pending))
	for _, change := range w.pending {
		changes = append(changes, change)
	}
	resync := w.resync
	w.pending = make(map[string]Change)
	w.resync = false
	w.timer = nil
	if !resync && len(changes) == 0 {
		w.mu.Unlock()
		return
	}
	w.seq++
	seq := w.seq
	w.mu.Unlock()

	sort.Slice(changes, func(i, j int) bool {
		return changes[i].Path < changes[j].Path
	})
	w.handler(Batch{Seq: seq, Resync: resync, Changes: changes})
}

func mergeChange(a, b Change) Change {
	if b.Kind == "delete" {
		return b
	}
	if a.Kind == "delete" {
		b.Kind = "create"
		return b
	}
	if a.Kind == "create" {
		b.Kind = "create"
		return b
	}
	return b
}
