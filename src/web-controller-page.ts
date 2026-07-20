/**
 * 手机控制器 Web 页面
 * 返回完整 HTML 页面字符串（内嵌 CSS + JS），通过 HTTP 响应发送给手机浏览器
 */

export function getControllerPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Godot MCP Actions</title>
<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
  color: #e8d5b7;
}

/* 隐藏滚动条但保持可滚动 */
.scroll-area {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.scroll-area::-webkit-scrollbar {
  display: none;
}

/* 顶部状态栏 */
.status-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: rgba(10, 10, 20, 0.85);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(212, 165, 116, 0.2);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
  transition: background-color 0.3s;
}
.status-dot.connected { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
.status-dot.connecting { background: #ffc107; box-shadow: 0 0 6px #ffc107; }
.status-dot.disconnected { background: #f44336; box-shadow: 0 0 6px #f44336; }

.status-text {
  font-size: 12px;
  color: #a89a8a;
  margin-right: auto;
}

.status-title {
  font-size: 14px;
  color: #d4a574;
  font-weight: 500;
}

/* 主内容区域 */
.main-content {
  height: 100%;
  padding-top: calc(52px + env(safe-area-inset-top));
  padding-bottom: calc(60px + env(safe-area-inset-bottom));
  padding-left: 12px;
  padding-right: 12px;
}

/* 分类标题 */
.category-title {
  font-size: 12px;
  color: #a08560;
  margin-top: 16px;
  margin-bottom: 8px;
  padding-left: 4px;
  letter-spacing: 1px;
}

/* 按钮网格 */
.action-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

/* 行动按钮 */
.action-btn {
  position: relative;
  min-height: 48px;
  padding: 14px 12px;
  border: 1px solid rgba(212, 165, 116, 0.4);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #e8d5b7;
  font-size: 15px;
  font-weight: 400;
  text-align: center;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
  animation: fadeIn 0.3s ease forwards;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}

.action-btn:active:not(:disabled) {
  transform: scale(0.95);
  background: rgba(212, 165, 116, 0.15);
  box-shadow: 0 0 12px rgba(212, 165, 116, 0.3);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.loading::after {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-left: 8px;
  border: 2px solid rgba(232, 213, 183, 0.3);
  border-top-color: #e8d5b7;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
}

.action-btn.full-width {
  grid-column: 1 / -1;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 底部返回栏 */
.bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  background: rgba(10, 10, 20, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid rgba(212, 165, 116, 0.2);
  display: none;
}

.bottom-bar.visible {
  display: block;
}

.back-btn {
  width: 100%;
  min-height: 44px;
  padding: 12px;
  border: 1px solid rgba(212, 165, 116, 0.5);
  border-radius: 8px;
  background: rgba(212, 165, 116, 0.1);
  color: #d4a574;
  font-size: 15px;
  font-weight: 500;
  text-align: center;
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
  outline: none;
}

.back-btn:active:not(:disabled) {
  transform: scale(0.97);
  background: rgba(212, 165, 116, 0.2);
}

.back-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 空状态与等待提示 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60%;
  color: #a08560;
  font-size: 15px;
}

.empty-state .icon {
  font-size: 32px;
  margin-bottom: 12px;
}

/* 等待游戏响应 */
.waiting-hint {
  text-align: center;
  padding: 20px;
  color: #a08560;
  font-size: 14px;
  animation: fadeIn 0.3s ease;
}

/* 刷新按钮 */
.refresh-btn {
  width: 28px;
  height: 28px;
  margin-left: 10px;
  border: 1px solid rgba(212, 165, 116, 0.4);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: #d4a574;
  font-size: 14px;
  line-height: 26px;
  text-align: center;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
  flex-shrink: 0;
}

.refresh-btn:active:not(:disabled) {
  transform: scale(0.9);
  background: rgba(212, 165, 116, 0.15);
}

.refresh-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.refresh-btn.spinning {
  animation: spin 0.8s linear infinite;
}
</style>
</head>
<body>

<!-- 顶部状态栏 -->
<div class="status-bar">
  <div class="status-dot connecting" id="statusDot"></div>
  <span class="status-text" id="statusText">连接中...</span>
  <span class="status-title">Godot MCP Actions</span>
  <button class="refresh-btn" id="refreshBtn" onclick="handleRefresh()" title="刷新行动列表">\ud83d\udd04</button>
</div>

<!-- 主内容区域 -->
<div class="main-content scroll-area" id="mainContent">
  <div class="empty-state" id="emptyState">
    <div class="icon">🎮</div>
    <div>等待游戏行动...</div>
  </div>
  <div id="actionsContainer" style="display:none;"></div>
</div>

<script>
// ===== 状态管理 =====
var state = {
  ws: null,
  actions: [],
  status: "connecting", // connected | connecting | disconnected
  reconnectTimer: null,
  isExecuting: false
};

// ===== 分类标题映射 =====
var CATEGORY_LABELS = {
  navigation: "\\ud83e\\udded 导航",
  menu: "\\ud83d\\udccb 菜单",
  combat: "\\u2694\\ufe0f 战斗",
  interaction: "\\ud83d\\udcac 交互",
  system: "\\u2699\\ufe0f 系统",
  ui: "\\ud83d\\udda5\\ufe0f 界面"
};

// ===== WebSocket 连接 =====
function connectWS() {
  updateStatus("connecting");

  var protocol = location.protocol === "https:" ? "wss:" : "ws:";
  var wsUrl = protocol + "//" + location.host + "/ws";
  var ws = new WebSocket(wsUrl);

  ws.onopen = function() {
    state.ws = ws;
    updateStatus("connected");
    // 连接成功后自动获取行动列表
    ws.send(JSON.stringify({ type: "get_actions" }));
  };

  ws.onmessage = function(event) {
    var msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    handleMessage(msg);
  };

  ws.onclose = function() {
    state.ws = null;
    updateStatus("disconnected");
    scheduleReconnect();
  };

  ws.onerror = function() {
    // onclose 会紧随触发，无需额外处理
  };
}

// ===== 自动重连 =====
function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(function() {
    state.reconnectTimer = null;
    connectWS();
  }, 3000);
}

// ===== 消息处理 =====
function handleMessage(msg) {
  if (msg.type === "actions_update") {
    state.isExecuting = false;
    state.actions = msg.actions || [];
    stopRefreshSpin();
    renderActions();
  } else if (msg.type === "error") {
    state.isExecuting = false;
    stopRefreshSpin();
    showError(msg.message || "发生错误");
  }
}

// ===== 状态更新 =====
function updateStatus(status) {
  state.status = status;
  var dot = document.getElementById("statusDot");
  var text = document.getElementById("statusText");
  dot.className = "status-dot " + status;
  var labels = { connected: "已连接", connecting: "连接中...", disconnected: "已断开" };
  text.textContent = labels[status] || status;
}

// ===== 渲染行动按钮 =====
function renderActions() {
  var container = document.getElementById("actionsContainer");
  var emptyState = document.getElementById("emptyState");

  var normalActions = state.actions;

  // 无行动时显示空状态
  if (normalActions.length === 0) {
    container.style.display = "none";
    emptyState.style.display = "flex";
    return;
  }

  // 按分类分组
  emptyState.style.display = "none";
  container.style.display = "block";

  var groups = {};
  var groupOrder = [];
  for (var j = 0; j < normalActions.length; j++) {
    var act = normalActions[j];
    var cat = act.category || "other";
    if (!groups[cat]) {
      groups[cat] = [];
      groupOrder.push(cat);
    }
    groups[cat].push(act);
  }

  var html = "";
  for (var k = 0; k < groupOrder.length; k++) {
    var category = groupOrder[k];
    var items = groups[category];
    var label = CATEGORY_LABELS[category] || "\\ud83d\\udccc 其他";
    html += '<div class="category-title">' + label + "</div>";
    html += '<div class="action-grid">';
    for (var m = 0; m < items.length; m++) {
      var item = items[m];
      var fullWidthClass = items.length === 1 ? " full-width" : "";
      var disabledAttr = item.enabled === false ? " disabled" : "";
      html += '<button class="action-btn' + fullWidthClass + '" data-id="' + escapeAttr(item.id) + '" onclick="handleAction(this)"' + disabledAttr + '>';
      html += escapeHtml(item.label);
      html += "</button>";
    }
    html += "</div>";
  }

  container.innerHTML = html;
}

// ===== 执行行动 =====
function handleAction(btn) {
  if (state.isExecuting) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  var actionId = btn.getAttribute("data-id");
  state.isExecuting = true;

  // 禁用所有按钮并给当前按钮添加 loading 状态
  var allBtns = document.querySelectorAll(".action-btn");
  for (var i = 0; i < allBtns.length; i++) {
    allBtns[i].disabled = true;
  }
  btn.classList.add("loading");
  document.getElementById("refreshBtn").disabled = true;

  // 发送执行命令
  state.ws.send(JSON.stringify({ type: "run_action", action_id: actionId }));
}

// ===== 显示错误 =====
function showError(message) {
  var container = document.getElementById("actionsContainer");
  var emptyState = document.getElementById("emptyState");
  emptyState.style.display = "none";
  container.style.display = "block";
  container.innerHTML = '<div class="waiting-hint" style="color:#f44336;">\\u274c ' + escapeHtml(message) + "</div>";
}

// ===== 工具函数 =====
function escapeHtml(str) {
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== 手动刷新行动列表 =====
function handleRefresh() {
  var btn = document.getElementById("refreshBtn");
  if (state.isExecuting) return;
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;

  btn.classList.add("spinning");
  btn.disabled = true;
  state.ws.send(JSON.stringify({ type: "get_actions" }));
}

function stopRefreshSpin() {
  var btn = document.getElementById("refreshBtn");
  btn.classList.remove("spinning");
  btn.disabled = false;
}

// ===== 启动连接 =====
connectWS();
</script>
</body>
</html>`;
}
