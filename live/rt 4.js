/* Supabase Realtime（Broadcast）の最小クライアント。先生のボードと生徒のライブボードで共通。
   RT(url, apikey, topic, onMsg(event, payload), onState(connected)) → { send(event, payload), close() }
   Phoenix プロトコル v1。切れたら2秒後につなぎ直す。 */
function RT(url, apikey, topic, onMsg, onState) {
  const full = 'realtime:' + topic;
  let ws = null, ref = 0, hb = null, closed = false, joined = false;
  const raw = o => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  function connect() {
    if (closed) return;
    ws = new WebSocket(url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(apikey) + '&vsn=1.0.0');
    ws.onopen = () => {
      raw({ topic: full, event: 'phx_join', ref: String(++ref), join_ref: '1',
        payload: { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: apikey } });
      hb = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
    };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.topic === full && m.event === 'phx_reply') { const ok = m.payload && m.payload.status === 'ok'; if (ok !== joined) { joined = ok; onState && onState(ok); } }
      else if (m.topic === full && m.event === 'broadcast' && m.payload) onMsg && onMsg(m.payload.event, m.payload.payload);
      else if (m.topic === full && (m.event === 'phx_close' || m.event === 'phx_error')) { joined = false; onState && onState(false); try { ws.close(); } catch (x) {} }
    };
    ws.onclose = () => { clearInterval(hb); if (joined) { joined = false; onState && onState(false); } if (!closed) setTimeout(connect, 2000); };
    ws.onerror = () => { try { ws.close(); } catch (x) {} };
  }
  connect();
  return {
    get ready() { return joined; },
    send(event, payload) { if (joined) raw({ topic: full, event: 'broadcast', ref: String(++ref), payload: { type: 'broadcast', event, payload } }); return joined; },
    close() { closed = true; clearInterval(hb); try { ws.close(); } catch (e) {} }
  };
}
