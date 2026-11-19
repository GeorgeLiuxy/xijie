package app.elysium.figma.dev;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import com.tencent.mm.opensdk.modelbase.BaseReq;
import com.tencent.mm.opensdk.modelbase.BaseResp;
import com.tencent.mm.opensdk.modelmsg.SendAuth;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.IWXAPIEventHandler;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;
import com.tencent.mm.opensdk.utils.ILog;
import org.json.JSONObject;

/** Exported only under the exact applicationId.wxapi.WXEntryActivity required by WeChat. */
public abstract class WechatAuthActivity extends Activity implements IWXAPIEventHandler {
    private IWXAPI api;
    static void silenceSdkLogs() {
        // SDK diagnostics can include the one-use authorization response. Leave other app logging alone.
        com.tencent.mm.opensdk.utils.Log.setLogImpl(new ILog() {
            public void v(String tag, String message) {} public void d(String tag, String message) {}
            public void i(String tag, String message) {} public void w(String tag, String message) {} public void e(String tag, String message) {}
        });
    }
    @Override public void onCreate(Bundle state) { super.onCreate(state); handle(getIntent()); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); handle(intent); }
    private void handle(Intent intent) {
        try {
            if (!BuildConfig.WECHAT_APP_ID.matches("wx[0-9a-fA-F]{16}")) { finish(); return; }
            synchronized (NativeAuthState.LOCK) {
                JSONObject value = NativeAuthState.pending(this);
                if (value == null || !"wechat_sdk".equals(value.optString("transport")) || !"wechat".equals(value.optString("provider"))
                    || !BuildConfig.WECHAT_APP_ID.equals(value.optString("appId")) || !"waiting_provider".equals(value.optString("stage"))) { finish(); return; }
            }
            silenceSdkLogs(); if (api == null) api = WXAPIFactory.createWXAPI(this, BuildConfig.WECHAT_APP_ID, true);
            if (intent == null || !api.handleIntent(intent, this)) finish();
        } catch (Exception ignored) { finish(); }
    }
    @Override public void onReq(BaseReq request) { finish(); }
    @Override public void onResp(BaseResp response) {
        try {
            if (!(response instanceof SendAuth.Resp)) return; SendAuth.Resp auth = (SendAuth.Resp) response;
            synchronized (NativeAuthState.LOCK) {
                JSONObject value = NativeAuthState.pending(this);
                if (value == null || !"wechat_sdk".equals(value.optString("transport")) || !"wechat".equals(value.optString("provider"))
                    || !"waiting_provider".equals(value.optString("stage")) || !BuildConfig.WECHAT_APP_ID.equals(value.optString("appId"))
                    || auth.state == null || !auth.state.equals(value.optString("authState"))) return;
                if (auth.errCode == 0 && NativeAuthState.validCode(auth.code)) value.put("authCode", auth.code).put("stage", "callback_received");
                else if (auth.errCode == -2) NativeAuthState.fail(value, "AUTH_CANCELLED");
                else if (auth.errCode == -4) NativeAuthState.fail(value, "AUTH_DENIED");
                else NativeAuthState.fail(value, "AUTH_RESTART_REQUIRED");
                NativeAuthState.save(this, value);
            }
            // The original WebView reads/redeems the private result; no credentials in Intent extras.
            Intent parent = new Intent(this, MainActivity.class); parent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP); startActivity(parent);
        } catch (Exception ignored) { /* A failed durable save is never delivered as successful authorization. */ }
        finally { finish(); }
    }
    @Override protected void onDestroy() { if (api != null) api.detach(); super.onDestroy(); }
}
