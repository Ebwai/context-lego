# 在新电脑安装 Context Lego

适用 DeepSeek Harness 桌面版；不适用普通 DeepSeek 网页或手机应用。当前依赖 Harness 0.2.x 的插件接口，本版本在 0.2.0-rc.2 上使用。

## 推荐：安装发布包

1. 安装 DeepSeek Harness，启动一次以生成 desktop profile，然后退出应用。
2. 从本仓库 Releases 下载 dsh-conversation-tree-0.3.0.tgz，保存到固定目录，例如 D:/plugins/。
3. 在 PowerShell 执行：

```powershell
dsh plugin --profile desktop add "D:/plugins/dsh-conversation-tree-0.3.0.tgz"
```

如果提示找不到 dsh，请使用 Harness 自带的命令入口。当前 Windows 安装的相对路径是 `<Harness安装目录>/resources/runtime/cli/bin/dsh.cmd`，例如：

```powershell
& "F:/dshwin/resources/runtime/cli/bin/dsh.cmd" plugin --profile desktop add "D:/plugins/dsh-conversation-tree-0.3.0.tgz"
```

4. 检查 `%USERPROFILE%/.dsh/profiles/desktop/package.json`，确保 `dsh.profile.bundles` 数组中包含 `"dsh-conversation-tree"`。若没有，将此项追加到原有数组，保留已有配置。例如：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-conversation-tree"
      ]
    }
  }
}
```

这是局部配置示例，不要用它覆盖整个文件。依赖项由上面的 add 命令管理。

5. 重启 Harness，在右下角打开“对话树”。在新电脑重新配置模型、账号和工作区。

## 源码安装（开发用）

安装 Node.js 和 npm，下载或克隆本仓库后执行：

```powershell
npm ci
npm run build
dsh plugin --profile desktop add "D:/plugins/context-lego"
```

随后按上文检查 bundles 配置并重启。源码目录必须保留在原位置。

## 文件和数据范围

发布包包含 package.json、cordis.patch.yml、lib/index.js、lib/history.js、lib/client.js 和说明文档。它不包含 node_modules、账号凭据、模型密钥、个人配置、会话或画板记录。

安装插件不会迁移旧画板和聊天。画板存于客户端 localStorage，原生会话由 Harness 单独保存；不要只复制画板数据，否则节点引用的会话可能不存在。本次提供插件部署，不包含历史数据迁移。
