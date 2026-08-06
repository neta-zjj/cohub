# Cohub Agent 部署

## 目录结构

```text
deploy/agent/
├── manifests/
│   ├── configmap.tmpl.yaml
│   ├── deployment.tmpl.yaml
│   └── service.tmpl.yaml
├── prod/
│   ├── secrets.template.yaml
│   └── values.yaml
└── dev/
    ├── secrets.template.yaml
    └── values.yaml
```

更详细的长期架构说明见：

- `deploy/agent/README.md`
- `docs/agent-sandbox-runtime.md`
