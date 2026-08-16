/**
 * dsh-context-ring — Client half
 *
 * Pure-CSS approach: NO DOM injection into the React-managed panel.
 *
 * - Ring colors are driven by a data-dsh-context attribute on the ContextMeter
 *   trigger button (idle = green, peak = yellow, theme tokens for contrast).
 * - The open panel's bottom status row is rendered by two absolutely
 *   positioned pseudo elements (::before = period label bottom-left,
 *   ::after = balance bottom-right, styled like the header figures).
 * - The hover tooltip bubble is a direct child of the ring's root span
 *   (Tooltip renders a Fragment), so its textContent can be rewritten safely
 *   (text-node update, not node insert/remove).
 *
 * Beijing time (Asia/Shanghai) is computed with Intl.DateTimeFormat so the
 * result is independent of the machine's timezone. Peak windows are
 * 09:00-12:00 and 14:00-18:00 (half-open).
 *
 * Usage: pass this as `code.client` in cordis_define.
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const css = `
button[data-dsh-context="idle"] svg circle[stroke-dasharray] {
  stroke: var(--dsw-alias-state-success-primary) !important;
}
button[data-dsh-context="idle"] svg circle:not([stroke-dasharray]) {
  stroke: color-mix(in srgb, var(--dsw-alias-state-success-primary) 30%, transparent) !important;
}
button[data-dsh-context="peak"] svg circle[stroke-dasharray] {
  stroke: var(--dsw-alias-state-warn-primary) !important;
}
button[data-dsh-context="peak"] svg circle:not([stroke-dasharray]) {
  stroke: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent) !important;
}
div[role="dialog"][data-dsh-period] {
  padding-bottom: 40px !important;
}
div[role="dialog"][data-dsh-period]::before {
  content: attr(data-dsh-period-label);
  position: absolute;
  bottom: 12px;
  left: 12px;
  max-width: calc(100% - 150px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
div[role="dialog"][data-dsh-period]::after {
  content: attr(data-dsh-balance);
  position: absolute;
  bottom: 12px;
  right: 12px;
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  font-weight: 500;
}
`;
    styles.insert(css);

    const isZh = (document.documentElement.lang || 'en').toLowerCase().startsWith('zh');

    const beijingHour = () => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(new Date());
      const part = parts.find((p) => p.type === 'hour');
      return part === undefined ? new Date().getHours() : parseInt(part.value, 10);
    };

    const findPanel = (button) => {
      let el = button.parentElement;
      while (el !== null) {
        const dialog = el.querySelector(':scope > div[role="dialog"]');
        if (dialog !== null) return dialog;
        el = el.parentElement;
      }
      return null;
    };

    let balanceText = isZh ? '余额：…' : 'Balance: …';
    let balanceShort = '…';
    let lastBalanceFetch = 0;
    let balanceInFlight = null;
    let tipPercent = null;

    const refreshBalance = () => {
      if (balanceInFlight !== null) return balanceInFlight;
      balanceInFlight = host.call('balance')
        .then((res) => {
          if (res !== null && typeof res === 'object' && res.ok === true && typeof res.balance === 'string') {
            const currency = typeof res.currency === 'string' ? res.currency : 'CNY';
            balanceText = (isZh ? '余额：' : 'Balance: ') + res.balance + ' ' + currency;
            balanceShort = res.balance + currency;
          } else {
            const code = (res !== null && typeof res === 'object' && typeof res.message === 'string')
              ? res.message
              : 'unknown';
            balanceText = (isZh ? '余额：获取失败' : 'Balance: unavailable') + ' (' + code + ')';
            balanceShort = (isZh ? '获取失败' : 'unavailable');
          }
        })
        .catch((error) => {
          const why = (error instanceof Error && typeof error.message === 'string')
            ? error.message.slice(0, 120)
            : String(error);
          balanceText = (isZh ? '余额：获取失败' : 'Balance: unavailable') + ' (' + why + ')';
          balanceShort = (isZh ? '获取失败' : 'unavailable');
        })
        .finally(() => {
          lastBalanceFetch = Date.now();
          balanceInFlight = null;
          for (const panel of document.querySelectorAll('div[role="dialog"][data-dsh-period]')) {
            panel.dataset.dshBalance = balanceText;
          }
        });
      return balanceInFlight;
    };

    const applyTip = (button, peak) => {
      const root = button.parentElement;
      if (root === null) return;
      const bubble = root.querySelector(':scope > span[role="tooltip"]');
      if (bubble === null) return;
      if (tipPercent === null) {
        const m = /(\d+(?:\.\d+)?)\s*%/.exec(bubble.textContent || '');
        tipPercent = m === null ? '?' : m[1];
      }
      const periodWord = peak
        ? (isZh ? '高峰时段' : 'Peak hours')
        : (isZh ? '空闲时段' : 'Off-peak hours');
      const text = isZh
        ? periodWord + ' 上下文已使用 ' + tipPercent + '% ' + balanceShort
        : periodWord + ': ' + tipPercent + '% of context used, balance ' + balanceShort;
      if (bubble.textContent !== text) bubble.textContent = text;
    };

    const applyState = () => {
      const hour = beijingHour();
      const peak = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
      const state = peak ? 'peak' : 'idle';
      const periodLabel = peak
        ? (isZh ? '当前时段：高峰时段' : 'Period: Peak hours')
        : (isZh ? '当前时段：空闲时段' : 'Period: Off-peak hours');

      const buttons = document.querySelectorAll('button[aria-haspopup="dialog"]');
      for (const button of buttons) {
        if (button.querySelector('svg circle[stroke-dasharray]') === null) continue;
        if (button.dataset.dshContext !== state) button.dataset.dshContext = state;

        applyTip(button, peak);

        const panel = findPanel(button);
        if (panel === null) continue;
        if (panel.dataset.dshPeriod !== state) panel.dataset.dshPeriod = state;
        if (panel.dataset.dshPeriodLabel !== periodLabel) panel.dataset.dshPeriodLabel = periodLabel;
        if (panel.dataset.dshBalance !== balanceText) panel.dataset.dshBalance = balanceText;

        if (Date.now() - lastBalanceFetch > 60000) refreshBalance();
      }
    };

    applyState();
    refreshBalance();
    ctx.effect(() => ctx.interval(applyState, 10000));
    ctx.effect(() => {
      const observer = new MutationObserver(applyState);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    });
  },
};
