# Agent Prod 部署

## 目录结构

```text
prod/
├── values.yaml
├── secrets.template.yaml
└── deploy.sh
```

## 部署步骤

```bash
cd deploy/agent/prod
cp secrets.template.yaml secrets.yaml
vim secrets.yaml
./deploy.sh
```

## 说明

- Agent 作为控制面独立部署
- 默认 Service 名称：`cohub-agent`
- Agent 作为 WebSocket 客户端主动连接各 Space 的 Sandbox
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

