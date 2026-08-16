/**
 * dsh-context-ring — Host half
 *
 * DeepSeek account balance over RPC. Resolves the WebUI's CURRENT model route
 * (provider) plus the llm-deepseek settings section for the key reference and
 * base URL — nothing hard-coded — then queries <baseURL>/user/balance via a
 * node -e script (undici fetch). curl.exe's schannel TLS stack fails on some
 * Windows machines (HTTP 000) while Node's stack works, hence node -e.
 *
 * The key travels in the env var DSBALKEY (no reserved DSH_ prefix, never in
 * argv or logs) and only the balance string crosses back to the Client.
 *
 * Usage: pass this as `code.host` in cordis_define.
 */
return {
  inject: ['credentials', 'shell', 'settings'],
  apply(ctx) {
    harness.handle('balance', async () => {
      try {
        // 1) Current route — the authoritative "WebUI-configured" provider.
        let provider = null;
        const defaultModel = ctx.get('agentDefaultModel');
        if (defaultModel !== undefined && typeof defaultModel.currentSelection === 'function') {
          const selection = defaultModel.currentSelection();
          if (selection !== null && typeof selection === 'object' && typeof selection.provider === 'string') {
            provider = selection.provider;
          }
        }
        if (provider === null || provider !== 'deepseek-official') {
          return { ok: false, message: 'not-deepseek:' + String(provider) };
        }

        // 2) Key reference + base URL from the llm-deepseek settings section.
        let apiKeyEnv = 'DEEPSEEK_API_KEY';
        let baseURL = 'https://api.deepseek.com';
        const section = ctx.settings.get('llm-deepseek');
        if (section !== undefined && section !== null && typeof section === 'object') {
          if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv.length > 0) {
            apiKeyEnv = section.apiKeyEnv;
          }
          if (typeof section.baseURL === 'string' && section.baseURL.length > 0) {
            baseURL = section.baseURL.replace(/\/+$/, '');
          }
        }

        // 3) Resolve the key through the same credential seam the adapter uses.
        const resolved = await ctx.credentials.resolve(apiKeyEnv);
        if (resolved === undefined || typeof resolved.value !== 'string' || resolved.value.length === 0) {
          return { ok: false, message: 'no-key:' + apiKeyEnv };
        }

        // 4) Node fetch (undici). curl's schannel TLS fails on some machines.
        const script = "fetch('" + baseURL + "/user/balance',{headers:{Authorization:'Bearer '+process.env.DSBALKEY},signal:AbortSignal.timeout(8000)}).then(async r=>{const t=await r.text();console.log(JSON.stringify({status:r.status,body:t}))}).catch(e=>{console.log(JSON.stringify({status:0,body:'ERR:'+e.message}));process.exit(0)})";
        const spec = ctx.shell.resolve({
          command: 'node -e "' + script + '"',
          env: { DSBALKEY: resolved.value },
          timeoutMs: 10000,
          stdoutMaxBytes: 65536,
        });
        const result = await ctx.shell.run(spec);
        if (result.sandbox !== undefined && result.sandbox.denied) {
          return { ok: false, message: 'sandbox-denied' };
        }
        if (result.timedOut) {
          return { ok: false, message: 'timeout' };
        }
        const stdout = result.stdout.text.trim();
        const nl = stdout.indexOf('\n');
        const lastLine = nl === -1 ? stdout : stdout.slice(nl + 1).trim();
        let data;
        try {
          data = JSON.parse(lastLine.length > 0 ? lastLine : stdout);
        } catch (error) {
          return { ok: false, message: 'bad-json:' + stdout.slice(0, 120) };
        }
        if (typeof data.status !== 'number' || data.status === 0) {
          return { ok: false, message: 'fetch:' + String(data.body).slice(0, 120) };
        }
        if (data.status !== 200) {
          return { ok: false, message: 'http-' + String(data.status) };
        }
        let parsed;
        try {
          parsed = JSON.parse(data.body);
        } catch (error) {
          return { ok: false, message: 'bad-body' };
        }
        const info = Array.isArray(parsed.balance_infos) ? parsed.balance_infos[0] : undefined;
        if (info === undefined || typeof info.total_balance !== 'string') {
          return { ok: false, message: 'bad-body' };
        }
        return { ok: true, balance: info.total_balance, currency: typeof info.currency === 'string' ? info.currency : 'CNY' };
      } catch (error) {
        const why = error instanceof Error ? error.message.slice(0, 120) : String(error);
        return { ok: false, message: 'error' + (why.length > 0 ? ':' + why : '') };
      }
    });
  },
};
