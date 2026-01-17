(function () {
  const SECTION_ID = 'telegram-bot-config-section';
  const STYLE_ID = 'telegram-bot-config-style';
  const API_URL = '/api/manage/sysConfig/telegram_bot';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .tg-bot-url {
        font-family: "Courier New", monospace;
        word-break: break-all;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--el-border-color-lighter);
        background: var(--el-fill-color-lighter);
        color: var(--el-text-color-primary);
      }
      .tg-bot-status {
        font-size: 12px;
        color: var(--el-color-success);
      }
      .tg-bot-status.error {
        color: var(--el-color-danger);
      }
      .tg-bot-hint {
        font-size: 12px;
        color: var(--el-text-color-secondary);
        margin-top: 6px;
      }
      .tg-bot-switch {
        display: inline-flex;
        align-items: center;
      }
      .tg-bot-switch .el-switch__input { display: none; }
      .tg-bot-switch .el-switch__core {
        position: relative;
        width: 40px;
        height: 20px;
        border-radius: 10px;
        background: var(--el-border-color);
        transition: all .2s;
        box-sizing: border-box;
        display: inline-block;
        cursor: pointer;
      }
      .tg-bot-switch .el-switch__action {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        transition: all .2s;
      }
      .tg-bot-switch.is-checked .el-switch__core {
        background: var(--el-color-primary);
      }
      .tg-bot-switch.is-checked .el-switch__action {
        left: 22px;
      }
      .tg-bot-switch.is-disabled {
        opacity: .6;
        cursor: not-allowed;
      }
      .tg-bot-switch.is-disabled .el-switch__core {
        cursor: not-allowed;
      }
      .tg-bot-inline { display: flex; align-items: center; gap: 8px; }
    `;
    document.head.appendChild(style);
  }

  function createSection(container) {
    if (document.getElementById(SECTION_ID)) return;
    injectStyles();

    const section = document.createElement('div');
    section.className = 'first-settings';
    section.id = SECTION_ID;
    section.setAttribute('data-v-6c3b44d2', '');
    section.innerHTML = `
      <h3 class="first-title" data-v-6c3b44d2>Telegram Bot</h3>
      <div class="el-form" data-v-6c3b44d2>
        <div class="el-form-item">
          <label class="el-form-item__label">启用</label>
          <div class="el-form-item__content">
            <div class="el-switch tg-bot-switch" id="tg-bot-switch">
              <input class="el-switch__input" type="checkbox" id="tg-bot-enabled" />
              <span class="el-switch__core"><span class="el-switch__action"></span></span>
            </div>
          </div>
        </div>
        <div class="el-form-item">
          <label class="el-form-item__label">Bot Token</label>
          <div class="el-form-item__content">
            <div class="el-input">
              <div class="el-input__wrapper">
                <input class="el-input__inner" type="password" id="tg-bot-token" placeholder="请输入 Bot Token" autocomplete="new-password" />
              </div>
            </div>
          </div>
        </div>
        <div class="el-form-item">
          <label class="el-form-item__label">Webhook Secret</label>
          <div class="el-form-item__content">
            <div class="el-input">
              <div class="el-input__wrapper">
                <input class="el-input__inner" type="text" id="tg-bot-webhook" placeholder="自动生成或手动填写" />
              </div>
            </div>
          </div>
        </div>
        <div class="el-form-item">
          <label class="el-form-item__label">Webhook URL</label>
          <div class="el-form-item__content">
            <div class="tg-bot-url" id="tg-bot-url">-</div>
          </div>
        </div>
        <div class="actions" data-v-6c3b44d2>
          <button class="el-button el-button--primary" type="button" id="tg-bot-save">保存设置</button>
          <button class="el-button" type="button" id="tg-bot-copy">复制 Webhook URL</button>
          <span class="tg-bot-status" id="tg-bot-status"></span>
        </div>
        <div class="tg-bot-hint" id="tg-bot-hint"></div>
      </div>
    `;

    container.appendChild(section);

    const enabledEl = section.querySelector('#tg-bot-enabled');
    const switchEl = section.querySelector('#tg-bot-switch');
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

    function syncSwitchClass() {
      switchEl.classList.toggle('is-checked', Boolean(enabledEl.checked));
      switchEl.classList.toggle('is-disabled', Boolean(enabledEl.disabled));
    }

    function setDisabled(isDisabled) {
      enabledEl.disabled = isDisabled;
      tokenEl.disabled = isDisabled;
      webhookEl.disabled = isDisabled;
      saveBtn.disabled = isDisabled;
      syncSwitchClass();
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
        syncSwitchClass();
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
    enabledEl.addEventListener('change', syncSwitchClass);
    switchEl.addEventListener('click', () => {
      if (enabledEl.disabled) return;
      enabledEl.checked = !enabledEl.checked;
      enabledEl.dispatchEvent(new Event('change'));
    });
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
