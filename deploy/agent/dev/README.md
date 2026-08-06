# Agent Dev 部署

## 目录结构

```text
dev/
├── values.yaml
└── deploy.sh
```

## 部署步骤

```bash
cd deploy/agent/dev
cp secrets.template.yaml secrets.yaml
vim secrets.yaml
./deploy.sh
```

如果需要覆盖镜像：

```bash
OVERRIDE_IMAGE=ghcr.io/example/cohub-agent:latest ./deploy.sh
```

## 说明

- Agent 作为控制面独立部署
- Agent 作为 WebSocket 客户端主动连接各 Space 的 Sandbox
- Session 数据目录由 Agent 自己管理（`SESSIONS_DIR`）
- 当前脚本会渲染并应用：
  - `configmap.tmpl.yaml`
  - `service.tmpl.yaml`
  - `deployment.tmpl.yaml`

## Values files

This repository ships `values.example.yaml` only.

```bash
cp values.example.yaml values.yaml
# edit values.yaml for your environment
./deploy.sh
```

Do not commit real `values.yaml` or `secrets.yaml`.

