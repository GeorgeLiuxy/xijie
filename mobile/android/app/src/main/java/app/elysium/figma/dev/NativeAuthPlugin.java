package app.elysium.figma.dev;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tencent.mm.opensdk.modelmsg.SendAuth;
import com.tencent.mm.opensdk.openapi.IWXAPI;
import com.tencent.mm.opensdk.openapi.WXAPIFactory;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Date;
import java.util.Iterator;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** First-party handoff only; the BFF remains the sole validator of provider identity. */
@CapacitorPlugin(name = "NativeAuth")
public class NativeAuthPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final long LIFETIME = 300000;
    private static class Failure extends Exception {
        final String code; final int status; final boolean terminal;
        Failure(String code, int status) { this(code, status, false); }
        Failure(String code, int status, boolean terminal) { this.code = code; this.status = status; this.terminal = terminal; }
    }
    private interface Work { void run() throws Exception; }
    private interface MainWork<T> { T run() throws Exception; }
    private void run(PluginCall call, Work work) {
        try { worker.execute(() -> { try { work.run(); } catch (Exception error) { reject(call, error); } }); }
        catch (RuntimeException unavailable) { reject(call, new Failure("AUTH_SERVICE_UNAVAILABLE", 503)); }
    }
    private void reject(PluginCall call, Exception error) {
        Failure failure = error instanceof Failure ? (Failure) error : new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
        // Never attach raw exceptions, HTTP bodies, SDK code/state or cookies to bridge diagnostics.
        call.reject("Native authorization could not be completed.", failure.code, new JSObject().put("status", failure.status));
    }
    private <T> T main(MainWork<T> work) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return work.run();
        AtomicReference<T> result = new AtomicReference<>(); AtomicReference<Exception> failure = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        getBridge().executeOnMainThread(() -> { try { result.set(work.run()); } catch (Exception error) { failure.set(error); } finally { done.countDown(); } });
        if (!done.await(5, TimeUnit.SECONDS)) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
        if (failure.get() != null) throw failure.get(); return result.get();
    }
    private void fields(JSONObject value, String allowed) throws Failure {
        for (Iterator<String> keys = value.keys(); keys.hasNext();) if (!Arrays.asList(allowed.split(",")).contains(keys.next())) throw new Failure("INVALID_ARGUMENT", 400);
    }
    private String optionalId(JSONObject value, String name) throws Failure {
        if (!value.has(name) || value.isNull(name)) return null;
        Object raw = value.opt(name); if (!(raw instanceof String) || !((String) raw).matches(NativeAuthState.UUID_PATTERN)) throw new Failure("INVALID_ARGUMENT", 400); return (String) raw;
    }
    private String optionalString(JSONObject value, String name, String fallback) throws Failure {
        if (!value.has(name)) return fallback;
        if (!(value.opt(name) instanceof String)) throw new Failure("INVALID_ARGUMENT", 400);
        return (String) value.opt(name);
    }
    private int port(URI value) { return value.getPort() >= 0 ? value.getPort() : "https".equals(value.getScheme()) ? 443 : 80; }
    private String origin() throws Exception {
        String configured = getBridge().getConfig().getServerUrl(); if (configured == null) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
        URI source = new URI(configured);
        boolean debug = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 && "http".equals(source.getScheme()) && "127.0.0.1".equals(source.getHost()) && source.getPort() > 0 && source.getPort() <= 65535;
        if (!("https".equals(source.getScheme()) || debug) || source.getHost() == null || source.getRawUserInfo() != null || source.getRawQuery() != null || source.getRawFragment() != null
            || !(source.getRawPath() == null || source.getRawPath().isEmpty() || source.getRawPath().equals("/")) || source.getPort() == 0 || source.getPort() > 65535) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
        return new URI(source.getScheme(), null, source.getHost().toLowerCase(Locale.ROOT), source.getPort() == 443 && "https".equals(source.getScheme()) ? -1 : source.getPort(), null, null, null).toASCIIString();
    }
    private boolean firstParty(URI actual) throws Exception {
        URI expected = new URI(origin());
        return actual.getHost() != null && actual.getRawUserInfo() == null && actual.getRawFragment() == null && expected.getScheme().equals(actual.getScheme()) && expected.getHost().equalsIgnoreCase(actual.getHost()) && port(expected) == port(actual);
    }
    private void page() throws Exception {
        origin(); main(() -> {
            String url = getBridge().getWebView().getUrl();
            if (getActivity() == null || getActivity().isFinishing() || getActivity().isDestroyed() || url == null || !firstParty(new URI(url))) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
            return null;
        });
    }
    private boolean oldWebView() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try { PackageInfo p = WebView.getCurrentWebViewPackage(); return p != null && p.packageName != null && p.versionName != null
            && (p.packageName.equals("com.android.chrome") || p.packageName.equals("com.android.webview") || p.packageName.matches("com\\.google\\.android\\.webview(?:\\.(?:beta|dev|canary))?") || p.packageName.matches("com\\.chrome\\.(?:beta|dev|canary)"))
            && p.versionName.matches("[1-9][0-9]{0,3}(?:\\.[0-9]+){1,3}") && Integer.parseInt(p.versionName.split("\\.")[0]) < 74;
        } catch (RuntimeException unknown) { return false; }
    }
    private String cookie(String path) throws Exception {
        page(); String source = origin(); return main(() -> {
            String value = CookieManager.getInstance().getCookie(source + path);
            if (value == null || value.isEmpty()) throw new Failure(oldWebView() ? "AUTH_WEBVIEW_OUTDATED" : "AUTH_SERVICE_UNAVAILABLE", 503);
            if (value.length() > 16384 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503); return value;
        });
    }
    private String proof() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    private String hash(String value) throws Exception { StringBuilder out = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))) out.append(String.format(Locale.ROOT, "%02x", b & 255)); return out.toString(); }
    private JSONObject current(JSONObject expected) throws Exception {
        JSONObject live = NativeAuthState.pending(getContext()); if (!NativeAuthState.same(live, expected)) throw new Failure("IDENTITY_SCOPE_CHANGED", 409); return live;
    }
    private JSObject publicPending(JSONObject value) throws Exception {
        JSObject result = new JSObject().put("pending", value != null); if (value == null) return result;
        for (String field : new String[]{"provider", "purpose", "transport", "expectedSessionId", "previousAccountId", "verifierChallenge", "launchProof", "startKey", "redeemKey", "launchKey", "completeKey", "expiresAt", "attemptId", "stage", "failureCode", "failed"})
            if (value.has(field) && !value.isNull(field)) result.put(field, value.get(field));
        if ("verified".equals(value.optString("stage")) && value.has("ticket")) result.put("ticket", value.getString("ticket")).put("verifier", value.getString("verifier")); return result;
    }
    private boolean installed() {
        try { getContext().getPackageManager().getPackageInfo("com.tencent.mm", 0); return true; }
        catch (android.content.pm.PackageManager.NameNotFoundException unavailable) { return false; }
    }
    private boolean configured() { return BuildConfig.WECHAT_APP_ID.matches("wx[0-9a-fA-F]{16}"); }
    @PluginMethod public void getCapabilities(PluginCall call) {
        run(call, () -> { page(); call.resolve(new JSObject().put("version", 1).put("browserProviders", new JSONArray(new String[]{"apple", "google", "wechat"}))
            .put("wechatNative", new JSObject().put("configured", configured()).put("installed", installed()))); });
    }
    @PluginMethod public void prepare(PluginCall call) {
        run(call, () -> {
            fields(call.getData(), "provider,purpose,transport,expectedSessionId,previousAccountId"); page();
            String provider = call.getString("provider"), purpose = call.getString("purpose"), transport = optionalString(call.getData(), "transport", "browser");
            String expected = optionalId(call.getData(), "expectedSessionId"), previous = optionalId(call.getData(), "previousAccountId");
            if (!("apple".equals(provider) || "google".equals(provider) || "wechat".equals(provider)) || !("sign_in".equals(purpose) || "switch".equals(purpose) || "reauthenticate".equals(purpose))
                || !("browser".equals(transport) || "wechat_sdk".equals(transport)) || "wechat_sdk".equals(transport) && !"wechat".equals(provider)
                || "reauthenticate".equals(purpose) && (expected == null || previous == null) || (expected == null) != (previous == null)) throw new Failure("INVALID_ARGUMENT", 400);
            if ("wechat_sdk".equals(transport) && !configured()) throw new Failure("AUTH_WECHAT_NOT_CONFIGURED", 503);
            if ("wechat_sdk".equals(transport) && !installed()) throw new Failure("AUTH_WECHAT_NOT_INSTALLED", 409);
            synchronized (NativeAuthState.LOCK) {
                JSONObject value = NativeAuthState.pending(getContext());
                if (value != null && !"failed".equals(value.optString("stage")) && value.optString("provider").equals(provider) && value.optString("purpose").equals(purpose) && value.optString("transport").equals(transport)
                    && value.optString("expectedSessionId", "").equals(expected == null ? "" : expected) && value.optString("previousAccountId", "").equals(previous == null ? "" : previous)) { call.resolve(publicPending(value)); return; }
                String verifier = proof(); value = new JSONObject().put("provider", provider).put("purpose", purpose).put("transport", transport).put("expectedSessionId", expected).put("previousAccountId", previous)
                    .put("verifier", verifier).put("verifierChallenge", hash(verifier)).put("launchProof", proof()).put("startKey", UUID.randomUUID().toString()).put("redeemKey", UUID.randomUUID().toString())
                    .put("launchKey", UUID.randomUUID().toString()).put("completeKey", UUID.randomUUID().toString()).put("generation", UUID.randomUUID().toString()).put("stage", "prepared").put("expiresAt", System.currentTimeMillis() + LIFETIME);
                NativeAuthState.save(getContext(), value); call.resolve(publicPending(value));
            }
        });
    }
    private JSONObject bind(PluginCall call) throws Exception {
        String id = optionalId(call.getData(), "attemptId"), start = optionalId(call.getData(), "startKey"); if (id == null) throw new Failure("INVALID_ARGUMENT", 400);
        Object rawExpiry = call.getData().opt("expiresAt");
        if (!(rawExpiry instanceof Number) || !Double.isFinite(((Number) rawExpiry).doubleValue()) || ((Number) rawExpiry).doubleValue() != ((Number) rawExpiry).longValue()) throw new Failure("INVALID_ARGUMENT", 400);
        long expires = ((Number) rawExpiry).longValue(); if (expires <= System.currentTimeMillis() || expires > System.currentTimeMillis() + LIFETIME) throw new Failure("INVALID_ARGUMENT", 400);
        synchronized (NativeAuthState.LOCK) {
            JSONObject value = NativeAuthState.pending(getContext());
            if (value == null || start != null && !start.equals(value.optString("startKey")) || value.has("attemptId") && !id.equals(value.optString("attemptId"))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409);
            String transport = optionalString(call.getData(), "transport", value.optString("transport")); if (!value.optString("transport").equals(transport)) throw new Failure("INVALID_ARGUMENT", 400);
            if (!("prepared".equals(value.optString("stage")) || "waiting_provider".equals(value.optString("stage")))) throw new Failure("AUTH_RESTART_REQUIRED", 409);
            String url = optionalString(call.getData(), "launchUrl", null);
            if ("browser".equals(transport)) {
                if (url == null) throw new Failure("INVALID_ARGUMENT", 400);
                URI uri = new URI(url); Uri androidUri = Uri.parse(url);
                if (!firstParty(uri) || !("/v1/auth/native-launch/" + id).equals(uri.getRawPath()) || androidUri.getQueryParameterNames().size() != 1
                    || !value.getString("launchProof").equals(androidUri.getQueryParameter("proof")) || uri.getRawQuery() == null || uri.getRawQuery().indexOf('&') >= 0) throw new Failure("INVALID_ARGUMENT", 400);
            } else if (url != null) {
                URI uri = new URI(url);
                if (!firstParty(uri) || !("/v1/auth/native-wechat/" + id + "/launch").equals(uri.getRawPath()) || uri.getRawQuery() != null) throw new Failure("INVALID_ARGUMENT", 400);
            }
            value.put("attemptId", id).put("expiresAt", Math.min(value.getLong("expiresAt"), expires)); NativeAuthState.save(getContext(), value); return value;
        }
    }
    @PluginMethod public void launch(PluginCall call) {
        run(call, () -> {
            fields(call.getData(), "attemptId,startKey,transport,expiresAt,launchUrl"); page(); JSONObject value = bind(call);
            if ("wechat_sdk".equals(value.optString("transport"))) { sdkLaunch(value); call.resolve(); return; }
            Uri androidUri = Uri.parse(call.getString("launchUrl"));
            main(() -> { synchronized (NativeAuthState.LOCK) {
                JSONObject live = current(value); live.put("stage", "waiting_provider"); NativeAuthState.save(getContext(), live);
                Intent intent = new Intent(Intent.ACTION_VIEW, androidUri); intent.addCategory(Intent.CATEGORY_BROWSABLE); getActivity().startActivity(intent);
            } return null; }); call.resolve();
        });
    }
    private JSONObject request(String path, JSONObject value, String cookies, JSONObject body, String key, boolean anonymousAllowed) throws Exception {
        HttpURLConnection request = (HttpURLConnection) new URL(origin() + path).openConnection();
        request.setInstanceFollowRedirects(false); request.setConnectTimeout(15000); request.setReadTimeout(20000); request.setUseCaches(false);
        request.setRequestProperty("Cookie", cookies); request.setRequestProperty("Origin", origin()); request.setRequestProperty("Accept", "application/json"); request.setRequestProperty("Accept-Encoding", "identity");
        String expected = value.optString("expectedSessionId", ""); if (!expected.isEmpty()) request.setRequestProperty("X-Xijie-Expected-Session", expected);
        try {
            if (body != null) {
                request.setRequestMethod("POST"); request.setDoOutput(true); request.setRequestProperty("Content-Type", "application/json"); request.setRequestProperty("Idempotency-Key", key);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); request.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = request.getOutputStream()) { output.write(bytes); }
            }
            int status = request.getResponseCode(); if (anonymousAllowed && status == 401) return null;
            String type = request.getContentType();
            if (type == null || !"application/json".equalsIgnoreCase(type.split(";", 2)[0].trim()) || request.getContentLengthLong() > 65536) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
            InputStream input = status >= 200 && status < 300 ? request.getInputStream() : request.getErrorStream(); if (input == null) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
            JSONObject response;
            try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int n; while ((n = stream.read(buffer)) != -1) { if (output.size() + n > 65536) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503); output.write(buffer, 0, n); }
                response = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
            if (status != 200) {
                JSONObject error = response.optJSONObject("error"); String code = error == null ? "" : error.optString("code");
                boolean terminal = code.equals("AUTH_RESTART_REQUIRED") || code.equals("IDENTITY_SCOPE_CHANGED") || status == 401 || status == 410;
                if (status == 401 || status == 410) code = "AUTH_RESTART_REQUIRED";
                if (!NativeAuthState.validFailure(code)) code = "AUTH_SERVICE_UNAVAILABLE";
                throw new Failure(code, status >= 400 && status <= 599 ? status : 503, terminal);
            }
            JSONObject data = response.optJSONObject("data"); if (data == null) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503); return data;
        } catch (Failure error) { throw error; } catch (Exception unknown) { throw new Failure("AUTH_RESULT_UNKNOWN", 503); }
        finally { request.disconnect(); }
    }
    private String checkedCookie(JSONObject value, String path) throws Exception {
        String cookies = cookie(path); JSONObject actual = request("/v1/sessions/current", value, cookies, null, null, true);
        String expected = value.optString("expectedSessionId", ""), previous = value.optString("previousAccountId", "");
        if (expected.isEmpty() ? actual != null : actual == null || !expected.equals(actual.optString("id")) || !previous.equals(actual.optString("accountId"))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409, true);
        if (!cookies.equals(cookie(path))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409, true);
        synchronized (NativeAuthState.LOCK) { current(value); } return cookies;
    }
    private long expiry(Object raw) throws Failure {
        if (!(raw instanceof String) || !((String) raw).matches("[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{3})?Z")) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
        String source = (String) raw; SimpleDateFormat format = new SimpleDateFormat(source.indexOf('.') >= 0 ? "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'" : "yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT);
        format.setLenient(false); format.setTimeZone(TimeZone.getTimeZone("UTC")); ParsePosition position = new ParsePosition(0); Date date = format.parse(source, position);
        if (date == null || position.getIndex() != source.length() || date.getTime() <= System.currentTimeMillis()) throw new Failure("AUTH_RESTART_REQUIRED", 410, true); return date.getTime();
    }
    private void terminal(JSONObject value, Failure error) throws Exception {
        if (!error.terminal) return;
        synchronized (NativeAuthState.LOCK) { JSONObject live = current(value); if (!"verified".equals(live.optString("stage"))) { NativeAuthState.fail(live, error.code); NativeAuthState.save(getContext(), live); } }
    }
    private void sdkLaunch(JSONObject value) throws Exception {
        try {
            if (!configured()) throw new Failure("AUTH_WECHAT_NOT_CONFIGURED", 503);
            if (!installed()) throw new Failure("AUTH_WECHAT_NOT_INSTALLED", 409);
            if (!"prepared".equals(value.optString("stage"))) return;
            String path = "/v1/auth/native-wechat/" + value.getString("attemptId") + "/launch"; String cookies = checkedCookie(value, path);
            JSONObject data = request(path, value, cookies, new JSONObject().put("launchProof", value.getString("launchProof")), value.getString("launchKey"), false);
            if (!BuildConfig.WECHAT_APP_ID.equals(data.optString("appId")) || !data.optString("state").matches(NativeAuthState.PROOF_PATTERN)) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
            long expires = expiry(data.opt("expiresAt")); if (!cookies.equals(cookie(path))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409, true);
            main(() -> { page(); synchronized (NativeAuthState.LOCK) {
                JSONObject live = current(value); if (!"prepared".equals(live.optString("stage"))) return null;
                live.put("appId", BuildConfig.WECHAT_APP_ID).put("authState", data.getString("state")).put("expiresAt", Math.min(live.getLong("expiresAt"), expires)).put("stage", "waiting_provider"); NativeAuthState.save(getContext(), live);
                WechatAuthActivity.silenceSdkLogs(); IWXAPI api = WXAPIFactory.createWXAPI(getContext(), BuildConfig.WECHAT_APP_ID, true);
                try {
                    SendAuth.Req auth = new SendAuth.Req(); auth.scope = "snsapi_userinfo"; auth.state = live.getString("authState");
                    if (!api.registerApp(BuildConfig.WECHAT_APP_ID) || !api.isWXAppInstalled() || !api.sendReq(auth)) {
                        NativeAuthState.fail(live, "AUTH_SDK_LAUNCH_FAILED"); NativeAuthState.save(getContext(), live); throw new Failure("AUTH_SDK_LAUNCH_FAILED", 503, true);
                    }
                } finally { api.detach(); }
            } return null; });
        } catch (Failure error) { terminal(value, error); throw error; }
    }
    private JSONObject complete(JSONObject value) throws Exception {
        if (!"wechat_sdk".equals(value.optString("transport")) || !("callback_received".equals(value.optString("stage")) || "completing".equals(value.optString("stage")))) return value;
        try {
            // An upgrade/configuration change must not resume an authorization for another AppID.
            if (!configured() || !BuildConfig.WECHAT_APP_ID.equals(value.optString("appId"))) throw new Failure("AUTH_RESTART_REQUIRED", 409, true);
            String path = "/v1/auth/native-wechat/" + value.getString("attemptId") + "/complete"; String cookies = checkedCookie(value, path);
            synchronized (NativeAuthState.LOCK) { value = current(value); value.put("stage", "completing"); value.remove("failureCode"); NativeAuthState.save(getContext(), value); }
            JSONObject data = request(path, value, cookies, new JSONObject().put("code", value.getString("authCode")).put("state", value.getString("authState")).put("verifier", value.getString("verifier")), value.getString("completeKey"), false);
            if (!data.optString("ticket").matches(NativeAuthState.PROOF_PATTERN)) throw new Failure("AUTH_SERVICE_UNAVAILABLE", 503);
            long expires = expiry(data.opt("expiresAt")); if (!cookies.equals(cookie(path))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409, true);
            synchronized (NativeAuthState.LOCK) {
                JSONObject live = current(value); live.put("ticket", data.getString("ticket")).put("expiresAt", Math.min(live.getLong("expiresAt"), expires)).put("stage", "verified");
                live.remove("authCode"); live.remove("authState"); live.remove("appId"); live.remove("failureCode"); NativeAuthState.save(getContext(), live); return live;
            }
        } catch (Failure error) {
            terminal(value, error);
            if (!error.terminal) synchronized (NativeAuthState.LOCK) { JSONObject live = current(value); live.put("failureCode", error.code); NativeAuthState.save(getContext(), live); }
            throw error;
        }
    }
    @PluginMethod public void getPending(PluginCall call) { run(call, () -> pending(call)); }
    @PluginMethod public void resume(PluginCall call) { run(call, () -> pending(call)); }
    private void pending(PluginCall call) throws Exception {
        fields(call.getData(), "attemptId,startKey"); page(); JSONObject value;
        synchronized (NativeAuthState.LOCK) {
            value = NativeAuthState.pending(getContext()); String id = optionalId(call.getData(), "attemptId"), start = optionalId(call.getData(), "startKey");
            if (value != null && (id != null && !id.equals(value.optString("attemptId")) || start != null && !start.equals(value.optString("startKey")))) throw new Failure("IDENTITY_SCOPE_CHANGED", 409);
        }
        if (value != null) value = complete(value);
        synchronized (NativeAuthState.LOCK) { if (value != null) value = current(value); call.resolve(publicPending(value)); }
    }
    @PluginMethod public void clear(PluginCall call) {
        // A user cancellation must fence a network reply immediately, not sit behind its timeout.
        // Every later completion rechecks the encrypted generation before it can publish a ticket.
        try {
            fields(call.getData(), "attemptId,startKey"); page(); String id = optionalId(call.getData(), "attemptId"), start = optionalId(call.getData(), "startKey");
            synchronized (NativeAuthState.LOCK) {
                JSONObject value = NativeAuthState.pending(getContext());
                if (value != null && (id != null && !id.equals(value.optString("attemptId")) || start != null && !start.equals(value.optString("startKey")))) { call.resolve(); return; }
                NativeAuthState.clear(getContext()); call.resolve();
            }
        } catch (Exception error) { reject(call, error); }
    }
    private void receive(Intent intent) {
        try {
            Uri uri = intent == null ? null : intent.getData(); if (uri == null || !firstParty(new URI(uri.toString())) || !"/native-auth/complete".equals(uri.getPath())) return;
            synchronized (NativeAuthState.LOCK) {
                JSONObject value = NativeAuthState.pending(getContext());
                if (value == null || !"browser".equals(value.optString("transport")) || !value.optString("attemptId").equals(uri.getQueryParameter("attemptId")) || "failed".equals(value.optString("stage"))) return;
                String ticket = uri.getQueryParameter("ticket");
                if (ticket != null && ticket.matches(NativeAuthState.PROOF_PATTERN) && uri.getQueryParameterNames().size() == 2 && uri.getEncodedQuery().indexOf('&') == uri.getEncodedQuery().lastIndexOf('&')) {
                    if (!value.has("ticket")) { value.put("ticket", ticket).put("stage", "verified"); NativeAuthState.save(getContext(), value); }
                } else if ("failed".equals(uri.getQueryParameter("status")) && uri.getQueryParameterNames().size() == 2 && !value.has("ticket")) { NativeAuthState.fail(value, "AUTH_DENIED"); NativeAuthState.save(getContext(), value); }
            }
        } catch (Exception ignored) { /* Untrusted, expired or late callbacks never change a session. */ }
    }
    @Override public void load() { receive(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { receive(intent); }
}
