(function () {
  const SECTION_ID = 'telegram-bot-config-section';
  const STYLE_ID = 'telegram-bot-config-style';
  const API_URL = '/api/manage/sysConfig/telegram_bot';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tg-bot-form { margin-top: 12px; display: grid; gap: 12px; }
      .tg-bot-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 12px; }
      .tg-bot-row label { color: #606266; font-size: 14px; }
      .tg-bot-row input[type="text"],
      .tg-bot-row input[type="password"] {
        width: 100%; padding: 8px 10px; border: 1px solid #dcdfe6; border-radius: 6px; font-size: 14px;
      }
      .tg-bot-row input[disabled] { background: #f5f7fa; color: #c0c4cc; }
      .tg-bot-actions { margin-top: 8px; display: flex; gap: 10px; align-items: center; }
      .tg-bot-actions button {
        padding: 8px 14px; border-radius: 6px; border: 1px solid #409eff; background: #409eff; color: #fff; cursor: pointer;
      }
      .tg-bot-actions button[disabled] { background: #a0cfff; border-color: #a0cfff; cursor: not-allowed; }
      .tg-bot-hint { font-size: 12px; color: #909399; }
      .tg-bot-status { font-size: 12px; color: #67c23a; }
      .tg-bot-status.error { color: #f56c6c; }
      .tg-bot-url { font-family: monospace; word-break: break-all; }
      .tg-bot-copy {
        padding: 6px 10px; border-radius: 6px; border: 1px solid #dcdfe6; background: #fff; cursor: pointer; font-size: 12px;
      }
    `;
    document.head.appendChild(style);
  }

  function createSection(container) {
    if (document.getElementById(SECTION_ID)) return;
    injectStyles();

    const section = document.createElement('div');
    section.className = 'first-settings';
    section.id = SECTION_ID;
    section.innerHTML = `
      <h3 class="first-title">Telegram Bot</h3>
      <div class="tg-bot-form">
        <div class="tg-bot-row">
          <label>启用</label>
          <input type="checkbox" id="tg-bot-enabled" />
        </div>
        <div class="tg-bot-row">
          <label>Bot Token</label>
          <input type="password" id="tg-bot-token" placeholder="请输入 Bot Token" autocomplete="new-password" />
        </div>
        <div class="tg-bot-row">
          <label>Webhook Secret</label>
          <input type="text" id="tg-bot-webhook" placeholder="自动生成或手动填写" />
        </div>
        <div class="tg-bot-row">
          <label>Webhook URL</label>
          <div class="tg-bot-url" id="tg-bot-url">-</div>
        </div>
        <div class="tg-bot-actions">
          <button id="tg-bot-save">保存设置</button>
          <button class="tg-bot-copy" id="tg-bot-copy">复制 Webhook URL</button>
          <span class="tg-bot-status" id="tg-bot-status"></span>
        </div>
        <div class="tg-bot-hint" id="tg-bot-hint"></div>
      </div>
    `;

    container.appendChild(section);

    const enabledEl = section.querySelector('#tg-bot-enabled');
    const tokenEl = section.querySelector('#tg-bot-token');
    const webhookEl = section.querySelector('#tg-bot-webhook');
    const urlEl = section.querySelector('#tg-bot-url');
    const saveBtn = section.querySelector('#tg-bot-save');
    const copyBtn = section.querySelector('#tg-bot-copy');
    const statusEl = section.querySelector('#tg-bot-status');
    const hintEl = section.querySelector('#tg-bot-hint');

    let currentConfig = null;

    function setStatus(text, isError) {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('error', Boolean(isError));
    }

    function updateWebhookUrl() {
      const secret = webhookEl.value.trim();
      if (!secret) {
        urlEl.textContent = '-';
        return;
      }
      urlEl.textContent = `${location.origin}/api/telegram/webhook/${secret}`;
    }

    function setDisabled(isDisabled) {
      enabledEl.disabled = isDisabled;
      tokenEl.disabled = isDisabled;
      webhookEl.disabled = isDisabled;
      saveBtn.disabled = isDisabled;
      if (isDisabled) {
        hintEl.textContent = '已由环境变量锁定，需在部署环境中修改。';
      } else {
        hintEl.textContent = '';
      }
    }

    async function loadConfig() {
      setStatus('加载中...');
      try {
        const res = await fetch(API_URL, { method: 'GET' });
        if (!res.ok) throw new Error('获取配置失败');
        const data = await res.json();
        currentConfig = data?.telegramBot || {};

        enabledEl.checked = Boolean(currentConfig.enabled);
        tokenEl.value = currentConfig.botToken || '';
        webhookEl.value = currentConfig.webhookSecret || '';
        updateWebhookUrl();

        setDisabled(Boolean(currentConfig.fixed));
        setStatus('');
      } catch (err) {
        setStatus('加载失败', true);
      }
    }

    async function saveConfig() {
      setStatus('保存中...');
      try {
        const payload = {
          telegramBot: {
            ...currentConfig,
            enabled: Boolean(enabledEl.checked),
            botToken: tokenEl.value.trim(),
            webhookSecret: webhookEl.value.trim(),
          },
        };

        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error('保存失败');
        const data = await res.json();
        currentConfig = data?.telegramBot || payload.telegramBot;
        webhookEl.value = currentConfig.webhookSecret || webhookEl.value;
        updateWebhookUrl();
        setStatus('已保存');
      } catch (err) {
        setStatus('保存失败', true);
      }
    }

    webhookEl.addEventListener('input', updateWebhookUrl);
    tokenEl.addEventListener('input', () => {
      if (!webhookEl.value.trim() && tokenEl.value.trim().length >= 16) {
        webhookEl.value = tokenEl.value.trim().slice(-16);
        updateWebhookUrl();
      }
    });

    saveBtn.addEventListener('click', () => saveConfig());
    copyBtn.addEventListener('click', async () => {
      const text = urlEl.textContent || '';
      if (!text || text === '-') return;
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Webhook URL 已复制');
      } catch (err) {
        setStatus('复制失败', true);
      }
    });

    loadConfig();
  }

  function tryMount() {
    const container = document.querySelector('.others-settings');
    if (container) createSection(container);
  }

  const observer = new MutationObserver(() => tryMount());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('hashchange', () => setTimeout(tryMount, 50));
  window.addEventListener('load', () => setTimeout(tryMount, 50));
})();
