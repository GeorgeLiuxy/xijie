package app.elysium.figma.dev;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Iterator;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** One private, account-bound camera operation; never accepts a caller-selected path or URL. */
@CapacitorPlugin(name = "ChatCapture")
public class ChatCapturePlugin extends Plugin {
    private static final String UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    private static final long HOUR = 3600000, MAX_RAW = 10L * 1024 * 1024, MAX_PREPARED = 1024 * 1024, SAFE = 9007199254740991L;
    private static final int GRANTS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private final Object lock = new Object();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean restoredCaptureCall, firstResumeHandled;
    private String launchedByThisInstance;
    private static class Failure extends Exception {
        final int status; final String code; final boolean retire;
        Failure(int status, String code) { this(status, code, false); }
        Failure(int status, String code, boolean retire) { this.status = status; this.code = code; this.retire = retire; }
    }
    private interface Work { void run() throws Exception; }
    private interface MainWork<T> { T run() throws Exception; }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("xijie_chat_capture_v1", 0); }
    private void reject(PluginCall call, Exception error) {
        Failure failure = error instanceof Failure ? (Failure) error : error instanceof org.json.JSONException ? new Failure(400, "INVALID_ARGUMENT") : new Failure(503, "CAPTURE_UNAVAILABLE");
        // No exception details, image bytes, path or server body enter bridge errors/logcat.
        if (call != null) call.reject("The camera operation could not be completed.", failure.code, new JSObject().put("status", failure.status));
    }
    private void run(PluginCall call, Work work) {
        try { worker.execute(() -> { try { work.run(); } catch (Exception error) { reject(call, error); } }); }
        catch (RuntimeException unavailable) { reject(call, new Failure(503, "CAPTURE_UNAVAILABLE")); }
    }
    private <T> T main(MainWork<T> work) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return work.run();
        AtomicReference<T> value = new AtomicReference<>(); AtomicReference<Exception> error = new AtomicReference<>(); CountDownLatch done = new CountDownLatch(1);
        getBridge().executeOnMainThread(() -> { try { value.set(work.run()); } catch (Exception issue) { error.set(issue); } finally { done.countDown(); } });
        if (!done.await(5, TimeUnit.SECONDS)) throw new Failure(503, "CAPTURE_UNAVAILABLE");
        if (error.get() != null) throw error.get(); return value.get();
    }
    private void fields(JSONObject value, String required, String optional) throws Failure {
        if (value == null) throw new Failure(400, "INVALID_ARGUMENT");
        ArrayList<String> allowed = new ArrayList<>(Arrays.asList((required + "," + optional).split(",")));
        for (Iterator<String> keys = value.keys(); keys.hasNext();) if (!allowed.contains(keys.next())) throw new Failure(400, "INVALID_ARGUMENT");
        for (String key : required.split(",")) if (!key.isEmpty() && (!value.has(key) || value.isNull(key))) throw new Failure(400, "INVALID_ARGUMENT");
    }
    private String id(Object value) throws Failure {
        if (!(value instanceof String) || !((String) value).matches(UUID)) throw new Failure(400, "INVALID_ARGUMENT");
        return ((String) value).toLowerCase(java.util.Locale.ROOT);
    }
    private long number(Object value, long min, long max) throws Failure {
        if (!(value instanceof Number)) throw new Failure(400, "INVALID_ARGUMENT");
        double n = ((Number) value).doubleValue(); long l = ((Number) value).longValue();
        if (!Double.isFinite(n) || n != l || l < min || l > max) throw new Failure(400, "INVALID_ARGUMENT"); return l;
    }
    private JSONObject identity(JSONObject value, boolean owner) throws Exception {
        fields(value, owner ? "accountId,sessionId,personId,conversationId" : "accountId,sessionId", "");
        JSONObject result = new JSONObject();
        for (String key : owner ? new String[]{"accountId","sessionId","personId","conversationId"} : new String[]{"accountId","sessionId"}) result.put(key, id(value.get(key)));
        return result;
    }
    private boolean sameIdentity(JSONObject a, JSONObject b) { return a.optString("accountId").equals(b.optString("accountId")) && a.optString("sessionId").equals(b.optString("sessionId")); }
    private boolean sameOwner(JSONObject a, JSONObject b) { return sameIdentity(a,b) && a.optString("personId").equals(b.optString("personId")) && a.optString("conversationId").equals(b.optString("conversationId")); }
    private String canonical(Object value) throws Exception {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof String) return JSONObject.quote((String) value);
        if (value instanceof Number) { double n = ((Number) value).doubleValue(); long l = ((Number) value).longValue(); return n == l ? Long.toString(l) : value.toString(); }
        if (value instanceof Boolean) return value.toString();
        if (!(value instanceof JSONObject)) throw new Failure(400, "INVALID_ARGUMENT");
        JSONObject object = (JSONObject) value; ArrayList<String> keys = new ArrayList<>(); object.keys().forEachRemaining(keys::add); Collections.sort(keys);
        StringBuilder text = new StringBuilder("{");
        for (String key : keys) { if (text.length() > 1) text.append(','); text.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key))); }
        return text.append('}').toString();
    }
    private boolean equal(Object a, Object b) throws Exception { return canonical(a).equals(canonical(b)); }
    private File directory() throws Exception {
        File cache = getContext().getCacheDir().getCanonicalFile(), root = new File(cache, "xijie-chat-capture");
        if (!root.isDirectory() && !root.mkdir()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
        if (!root.getCanonicalFile().equals(root.getAbsoluteFile()) || !root.getCanonicalFile().getParentFile().equals(cache)) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
        return root.getCanonicalFile();
    }
    private File file(String operation, String suffix) throws Exception {
        String name = id(operation) + suffix;
        if (!Arrays.asList(".raw.jpg", ".prepared.jpg", ".prepared.tmp").contains(suffix)) throw new Failure(400, "INVALID_ARGUMENT");
        File root = directory(), result = new File(root, name).getCanonicalFile();
        if (!root.equals(result.getParentFile())) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE"); return result;
    }
    private Uri uri(String operation) throws Exception { return FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file(operation, ".raw.jpg")); }
    private JSONObject journal() throws Exception {
        String saved = prefs().getString("pending", null); if (saved == null) return null;
        try {
            if (saved.getBytes(StandardCharsets.UTF_8).length > 32768) throw new Exception();
            JSONObject value = new JSONObject(saved); fields(value,"operationId,owner,pageId,state,revision,createdAtMs,expiresAtMs,generation,authorities","prepared,plan,tombstone,restored");
            id(value.get("operationId")); identity(value.getJSONObject("owner"), true); id(value.get("pageId"));
            number(value.get("revision"), 1, SAFE); number(value.get("generation"), 0, SAFE); long created = number(value.get("createdAtMs"), 1, SAFE);
            if (number(value.get("expiresAtMs"), 1, SAFE) != created + HOUR || !Arrays.asList("capturing", "ready").contains(value.getString("state"))) throw new Exception();
            JSONObject authorities = value.getJSONObject("authorities"); fields(authorities,"private_story_storage,private_chat_photo_storage,person_chat_image_replies","");
            for (String purpose : new String[]{"private_story_storage","private_chat_photo_storage","person_chat_image_replies"}) number(authorities.get(purpose),1,SAFE);
            for (String key : new String[]{"tombstone","restored"}) if (value.has(key) && !(value.get(key) instanceof Boolean)) throw new Exception();
            if ("ready".equals(value.getString("state"))) descriptor(value.getJSONObject("prepared"));
            if (value.has("prepared")) descriptor(value.getJSONObject("prepared"));
            if (value.has("plan")) plan(value.getJSONObject("plan"),value);
            return value;
        } catch (Exception corrupted) { throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE"); }
    }
    private void store(JSONObject value) throws Exception {
        if (value.toString().getBytes(StandardCharsets.UTF_8).length > 32768) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");
        String previous = prefs().getString("pending",null);
        if (!prefs().edit().putString("pending",value.toString()).commit()) {
            // commit(false) still changes SharedPreferences' in-memory map. An
            // identical retry must not mistake that uncommitted revision for a
            // durable acknowledgment and start the corresponding HTTP mutation.
            SharedPreferences.Editor restore = prefs().edit(); if (previous == null) restore.remove("pending"); else restore.putString("pending",previous); restore.commit();
            throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");
        }
    }
    private JSONObject cleanupJournal() throws Exception {
        // Cleanup needs only the original immutable binding. A damaged plan or
        // fingerprint must seal reads without making scoped deletion impossible.
        String saved = prefs().getString("pending",null); if (saved == null) return null;
        try {
            if (saved.getBytes(StandardCharsets.UTF_8).length > 32768) throw new Exception();
            JSONObject value = new JSONObject(saved); id(value.get("operationId")); identity(value.getJSONObject("owner"),true); number(value.get("generation"),0,SAFE); return value;
        } catch (Exception corruptBinding) { throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE"); }
    }
    private JSONObject camera() throws Exception {
        String saved = prefs().getString("camera",null); if (saved == null) return null;
        JSONObject value = new JSONObject(saved); fields(value,"operationId,owner,pageId,createdAtMs,launchState","");
        id(value.get("operationId")); identity(value.getJSONObject("owner"),true); id(value.get("pageId")); number(value.get("createdAtMs"),1,SAFE);
        if (!Arrays.asList("prepared","launched").contains(value.getString("launchState"))) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE"); return value;
    }
    private void clearCamera(String operation) throws Exception {
        synchronized (lock) { JSONObject pending = camera(); if (pending != null && operation.equals(pending.getString("operationId")) && !prefs().edit().remove("camera").commit()) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE"); }
    }
    private void rollbackUnlaunched(JSONObject value) throws Exception {
        // A failed SharedPreferences commit may already have changed its in-memory
        // map. Roll back that map as well, and keep a tombstone if cleanup fails.
        synchronized (lock) {
            JSONObject pending = journal();
            if (pending != null && !sameOperation(pending,value)) return;
            String operation = value.getString("operationId");
            boolean removed = true;
            try { removeFiles(operation); } catch (Exception failure) { removed = false; }
            long generation = prefs().getLong("generation",0) + 1;
            SharedPreferences.Editor edit = prefs().edit().remove("camera").putLong("generation",generation);
            if (removed) edit.remove("pending"); else edit.putString("pending",value.put("generation",generation).put("tombstone",true).toString());
            if (!edit.commit() || !removed) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");
        }
    }
    private boolean sameOperation(JSONObject a, JSONObject b) throws Exception { return a != null && b != null && a.getString("operationId").equals(b.getString("operationId")) && a.getLong("generation") == b.getLong("generation") && sameOwner(a.getJSONObject("owner"), b.getJSONObject("owner")); }
    private JSONObject current(JSONObject expected) throws Exception {
        JSONObject live = journal();
        if (!sameOperation(live, expected) || live.optBoolean("tombstone") || live.getLong("generation") != prefs().getLong("generation", 0)) throw new Failure(409, "CAPTURE_CHANGED");
        if (live.getLong("expiresAtMs") <= System.currentTimeMillis()) { retire(live); throw new Failure(410, "CAPTURE_EXPIRED"); }
        return live;
    }
    private JSONObject match(JSONObject owner, String operation) throws Exception {
        synchronized (lock) {
            JSONObject live = journal();
            if (live == null || !live.getString("operationId").equals(operation) || !sameOwner(live.getJSONObject("owner"), owner)) throw new Failure(409, "CAPTURE_CHANGED");
            return current(live);
        }
    }
    private JSONObject tombstone(JSONObject expected) throws Exception {
        synchronized (lock) {
            JSONObject live = cleanupJournal(); if (live == null || !sameOperation(live, expected)) return null;
            if (!live.optBoolean("tombstone")) {
                long generation = prefs().getLong("generation", 0) + 1;
                live.put("tombstone", true).put("generation", generation);
                if (!prefs().edit().putLong("generation", generation).putString("pending", live.toString()).commit()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
            }
            return live;
        }
    }
    private void removeFiles(String operation) throws Exception {
        getContext().revokeUriPermission(uri(operation), GRANTS);
        for (String suffix : new String[]{".raw.jpg", ".prepared.jpg", ".prepared.tmp"}) {
            File value = file(operation, suffix); if (value.exists() && !value.delete()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
            if (value.exists()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
        }
    }
    private void retire(JSONObject expected) throws Exception {
        JSONObject retired = tombstone(expected); if (retired == null) return;
        removeFiles(retired.getString("operationId"));
        synchronized (lock) { JSONObject live = cleanupJournal(); if (sameOperation(live, retired) && !prefs().edit().remove("pending").commit()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE"); }
    }
    private int port(URI value) { return value.getPort() >= 0 ? value.getPort() : "https".equals(value.getScheme()) ? 443 : 80; }
    private String origin() throws Exception {
        String configured = getBridge().getConfig().getServerUrl(); if (configured == null) throw new Failure(503, "CAPTURE_UNAVAILABLE");
        URI source = new URI(configured);
        boolean debug = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0 && "http".equals(source.getScheme()) && "127.0.0.1".equals(source.getHost()) && source.getPort() > 0 && source.getPort() <= 65535;
        if (!("https".equals(source.getScheme()) || debug) || source.getHost() == null || source.getRawUserInfo() != null || source.getRawQuery() != null || source.getRawFragment() != null || !(source.getRawPath() == null || source.getRawPath().isEmpty() || source.getRawPath().equals("/")) || source.getPort() == 0 || source.getPort() > 65535) throw new Failure(503, "CAPTURE_UNAVAILABLE");
        return new URI(source.getScheme(), null, source.getHost().toLowerCase(java.util.Locale.ROOT), source.getPort() == 443 && "https".equals(source.getScheme()) ? -1 : source.getPort(), null, null, null).toASCIIString();
    }
    private void page(String origin) throws Exception {
        main(() -> {
            Activity activity = getActivity(); String url = getBridge().getWebView().getUrl();
            if (activity == null || activity.isFinishing() || activity.isDestroyed() || url == null) throw new Failure(503, "CAPTURE_UNAVAILABLE");
            URI wanted = new URI(origin), actual = new URI(url);
            if (actual.getHost() == null || actual.getRawUserInfo() != null || !wanted.getScheme().equals(actual.getScheme()) || !wanted.getHost().equalsIgnoreCase(actual.getHost()) || port(wanted) != port(actual)) throw new Failure(401, "UNAUTHENTICATED"); return null;
        });
    }
    private boolean oldWebView() {
        if (Build.VERSION.SDK_INT < 26) return false;
        try { PackageInfo p = WebView.getCurrentWebViewPackage(); return p != null && p.packageName != null && p.versionName != null
            && (p.packageName.equals("com.android.chrome") || p.packageName.equals("com.android.webview") || p.packageName.matches("com\\.google\\.android\\.webview(?:\\.(?:beta|dev|canary))?") || p.packageName.matches("com\\.chrome\\.(?:beta|dev|canary)"))
            && p.versionName.matches("[1-9][0-9]{0,3}(?:\\.[0-9]+){1,3}") && Integer.parseInt(p.versionName.split("\\.")[0]) < 74;
        } catch (RuntimeException unknown) { return false; }
    }
    private String cookie(String origin) throws Exception {
        page(origin);
        return main(() -> {
            String value = CookieManager.getInstance().getCookie(origin + "/v1/sessions/current");
            if (value == null || value.isEmpty()) throw new Failure(503, oldWebView() ? "CAPTURE_WEBVIEW_OUTDATED" : "CAPTURE_SERVICE_UNAVAILABLE");
            if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) throw new Failure(401, "UNAUTHENTICATED"); return value;
        });
    }
    private byte[] bytes(InputStream input, long maximum) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[16384]; int count;
        while ((count = input.read(buffer)) != -1) { if (output.size() + count > maximum) throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE"); output.write(buffer, 0, count); } return output.toByteArray();
    }
    private JSONObject get(String origin, String path, JSONObject owner, String cookie) throws Exception {
        HttpURLConnection request = (HttpURLConnection) new URL(origin + path).openConnection();
        request.setInstanceFollowRedirects(false); request.setConnectTimeout(15000); request.setReadTimeout(20000); request.setUseCaches(false);
        request.setRequestProperty("Cookie", cookie); request.setRequestProperty("Origin", origin); request.setRequestProperty("X-Xijie-Expected-Session", owner.getString("sessionId")); request.setRequestProperty("Accept", "application/json"); request.setRequestProperty("Accept-Encoding", "identity");
        try {
            int status = request.getResponseCode();
            if (status == 401) throw new Failure(401, "UNAUTHENTICATED");
            if (status == 404 && path.startsWith("/v1/conversations/")) throw new Failure(404, "CAPTURE_TARGET_UNAVAILABLE", true);
            if (status != 200 || request.getContentType() == null || !request.getContentType().split(";", 2)[0].trim().equalsIgnoreCase("application/json") || request.getContentLengthLong() > 65536) throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE");
            try (InputStream input = request.getInputStream()) { return new JSONObject(new String(bytes(input, 65536), StandardCharsets.UTF_8)); }
        } catch (Failure failure) { throw failure; } catch (Exception unavailable) { throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE"); }
        finally { request.disconnect(); }
    }
    private String session(JSONObject owner) throws Exception {
        String origin = origin(), cookie = cookie(origin);
        JSONObject session;
        try { session = get(origin, "/v1/sessions/current", owner, cookie).getJSONObject("data"); }
        catch (org.json.JSONException malformed) { throw new Failure(503,"CAPTURE_SERVICE_UNAVAILABLE"); }
        if (!owner.getString("sessionId").equals(session.optString("id")) || !owner.getString("accountId").equals(session.optString("accountId"))) throw new Failure(409, "CAPTURE_OWNER_CHANGED");
        if (!cookie.equals(cookie(origin))) throw new Failure(409, "CAPTURE_OWNER_CHANGED"); return cookie;
    }
    private JSONObject authorize(JSONObject owner, JSONObject expected) throws Exception {
        try {
            String origin = origin(), cookie = session(owner);
            JSONObject conversation = get(origin, "/v1/conversations/" + owner.getString("conversationId"), owner, cookie).getJSONObject("data");
            if (!owner.getString("conversationId").equals(conversation.optString("id")) || !"direct".equals(conversation.optString("kind")) || !owner.getString("personId").equals(conversation.optString("personId"))) throw new Failure(404, "CAPTURE_TARGET_UNAVAILABLE", true);
            if (!Boolean.TRUE.equals(conversation.opt("canSend"))) throw new Failure(403, "CAPTURE_PERMISSION_REQUIRED", true);
            JSONObject meta = get(origin, "/v1/accounts/me/consents?limit=1", owner, cookie).getJSONObject("meta"), versions = new JSONObject();
            String[] purposes = {"private_story_storage", "private_chat_photo_storage", "person_chat_image_replies"}, authorities = {"storyStorage", "chatPhotoStorage", "chatImageReplies"};
            for (int i = 0; i < purposes.length; i++) {
                JSONObject authority = meta.getJSONObject(authorities[i]);
                if (!(authority.opt("allowed") instanceof Boolean)) throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE");
                if (!authority.getBoolean("allowed")) throw new Failure(403, "CAPTURE_PERMISSION_REQUIRED", true);
                long version = number(authority.get("authorizationVersion"), 1, SAFE);
                if (number(meta.getJSONObject("currentAuthorizationVersions").get(purposes[i]), 1, SAFE) != version) throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE");
                versions.put(purposes[i], version);
            }
            if (expected != null && !equal(versions, expected.getJSONObject("authorities"))) throw new Failure(409, "CAPTURE_AUTHORIZATION_CHANGED", true);
            if (!cookie.equals(cookie(origin))) throw new Failure(409, "CAPTURE_OWNER_CHANGED");
            return versions;
        } catch (Failure failure) { if (failure.retire && expected != null) retire(expected); if (failure.status == 400) throw new Failure(503,"CAPTURE_SERVICE_UNAVAILABLE"); throw failure; }
        catch (Exception unavailable) { throw new Failure(503, "CAPTURE_SERVICE_UNAVAILABLE"); }
    }
    private JSObject publicCapture(JSONObject value, String pageId, boolean restored) throws Exception {
        JSObject result = new JSObject(); for (String key : new String[]{"operationId", "owner", "pageId", "state", "revision", "createdAtMs", "expiresAtMs"}) result.put(key, value.get(key));
        result.put("restored", restored || value.optBoolean("restored") || !pageId.equals(value.getString("pageId")));
        if (value.has("prepared")) result.put("prepared", value.getJSONObject("prepared")); if (value.has("plan")) result.put("plan", value.getJSONObject("plan")); return result;
    }
    private void descriptor(JSONObject value) throws Exception {
        fields(value,"mimeType,byteSize,sha256,width,height","");
        if (!"image/jpeg".equals(value.get("mimeType")) || !(value.get("sha256") instanceof String) || !value.getString("sha256").matches("[0-9a-f]{64}")) throw new Failure(400,"INVALID_ARGUMENT");
        number(value.get("byteSize"),1,MAX_PREPARED); number(value.get("width"),1,720); number(value.get("height"),1,720);
    }
    private String sha(byte[] value) throws Exception { StringBuilder out = new StringBuilder(); for (byte b : MessageDigest.getInstance("SHA-256").digest(value)) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return out.toString(); }
    private JSONObject normalize(JSONObject expected) throws Exception {
        String operation = expected.getString("operationId"); File raw = file(operation, ".raw.jpg");
        if (!raw.isFile() || raw.length() == 0) throw new Failure(410, "CAPTURE_FILE_MISSING");
        if (raw.length() > MAX_RAW) throw new Failure(400, "CAPTURE_INVALID_IMAGE");
        BitmapFactory.Options bounds = new BitmapFactory.Options(); bounds.inJustDecodeBounds = true; BitmapFactory.decodeFile(raw.getPath(), bounds);
        if (!"image/jpeg".equals(bounds.outMimeType) || bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 32000000) throw new Failure(400, "CAPTURE_INVALID_IMAGE");
        int orientation = new ExifInterface(raw.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        BitmapFactory.Options options = new BitmapFactory.Options(); options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 1440) options.inSampleSize *= 2;
        Bitmap decoded = null, rotated = null, scaled = null;
        try {
            decoded = BitmapFactory.decodeFile(raw.getPath(), options); if (decoded == null) throw new Failure(400, "CAPTURE_INVALID_IMAGE");
            Matrix transform = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: transform.setScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_180: transform.setRotate(180); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: transform.setScale(1, -1); break;
                case ExifInterface.ORIENTATION_TRANSPOSE: transform.setRotate(90); transform.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_90: transform.setRotate(90); break;
                case ExifInterface.ORIENTATION_TRANSVERSE: transform.setRotate(-90); transform.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_270: transform.setRotate(-90); break;
                default: break;
            }
            rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), transform, true);
            double ratio = Math.min(1, 720.0 / Math.max(rotated.getWidth(), rotated.getHeight()));
            scaled = Bitmap.createScaledBitmap(rotated, Math.max(1, (int) Math.round(rotated.getWidth() * ratio)), Math.max(1, (int) Math.round(rotated.getHeight() * ratio)), true);
            ByteArrayOutputStream output = new ByteArrayOutputStream(); if (!scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)) throw new Failure(400, "CAPTURE_INVALID_IMAGE");
            byte[] prepared = output.toByteArray(); if (prepared.length == 0 || prepared.length > MAX_PREPARED) throw new Failure(400, "CAPTURE_INVALID_IMAGE");
            synchronized (lock) {
                current(expected); File temporary = file(operation, ".prepared.tmp"), destination = file(operation, ".prepared.jpg");
                try (FileOutputStream writer = new FileOutputStream(temporary)) { writer.write(prepared); writer.flush(); writer.getFD().sync(); }
                if (destination.exists() || !temporary.renameTo(destination)) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
                return new JSONObject().put("mimeType", "image/jpeg").put("byteSize", prepared.length).put("sha256", sha(prepared)).put("width", scaled.getWidth()).put("height", scaled.getHeight());
            }
        } catch (OutOfMemoryError tooLarge) { throw new Failure(400, "CAPTURE_INVALID_IMAGE"); }
        finally { if (scaled != null && scaled != rotated && scaled != decoded) scaled.recycle(); if (rotated != null && rotated != decoded) rotated.recycle(); if (decoded != null) decoded.recycle(); }
    }
    @PluginMethod public void capture(PluginCall call) {
        run(call, () -> {
            fields(call.getData(), "owner,operationId,pageId", ""); JSONObject owner = identity(call.getData().getJSONObject("owner"), true); String operation = id(call.getData().get("operationId")), pageId = id(call.getData().get("pageId"));
            JSONObject authorities = authorize(owner, null), value;
            synchronized (lock) {
                value = journal();
                if (value != null) {
                    value = current(value);
                    if (!operation.equals(value.getString("operationId")) || !sameOwner(owner, value.getJSONObject("owner"))) throw new Failure(409, "CAPTURE_PENDING");
                    call.resolve(publicCapture(value, pageId, false)); return;
                }
                if (camera() != null) throw new Failure(409,"CAPTURE_PENDING");
                File raw = file(operation, ".raw.jpg"); if (raw.exists() || !raw.createNewFile()) throw new Failure(503, "CAPTURE_STORAGE_UNAVAILABLE");
                long now = System.currentTimeMillis(); value = new JSONObject().put("operationId", operation).put("owner", owner).put("pageId", pageId).put("state", "capturing").put("revision", 1).put("createdAtMs", now).put("expiresAtMs", now + HOUR).put("generation", prefs().getLong("generation", 0)).put("authorities", authorities);
                try {
                    if (!prefs().edit().putString("pending",value.toString()).putString("camera",new JSONObject().put("operationId",operation).put("owner",owner).put("pageId",pageId).put("createdAtMs",now).put("launchState","prepared").toString()).commit()) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");
                } catch (Exception failure) { rollbackUnlaunched(value); throw failure; }
            }
            JSONObject started = value;
            try {
                main(() -> {
                    synchronized (lock) {
                        current(started);
                        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE); Uri output = uri(operation);
                        intent.putExtra(MediaStore.EXTRA_OUTPUT, output); intent.setClipData(ClipData.newRawUri("Chat photo", output)); intent.addFlags(GRANTS);
                        if (intent.resolveActivity(getActivity().getPackageManager()) == null) throw new Failure(503, "CAPTURE_UNAVAILABLE");
                        JSONObject waiting = camera(); waiting.put("launchState","launched");
                        if (!prefs().edit().putString("camera",waiting.toString()).commit()) throw new Failure(503,"CAPTURE_STORAGE_UNAVAILABLE");
                        launchedByThisInstance = operation;
                        // Final generation check and granting/launching are indivisible
                        // with scoped cleanup; a released operation cannot launch later.
                        startActivityForResult(call, intent, "cameraResult");
                        return null;
                    }
                });
            } catch (Exception failure) { clearCamera(operation); retire(started); throw failure; }
        });
    }
    @ActivityCallback private void cameraResult(PluginCall call, ActivityResult result) {
        run(call, () -> {
            JSONObject pending; synchronized (lock) { pending = camera(); }
            if (pending == null) { if (call != null) reject(call,new Failure(409,"CAPTURE_CHANGED")); return; }
            String operation = pending.getString("operationId"), pageId = pending.getString("pageId"); JSONObject owner = pending.getJSONObject("owner"), value;
            if (call != null && (!operation.equals(id(call.getData().get("operationId"))) || !sameOwner(owner,identity(call.getData().getJSONObject("owner"),true)))) throw new Failure(409,"CAPTURE_CHANGED");
            clearCamera(operation);
            try { value = match(owner, operation); }
            catch (Failure changed) { synchronized (lock) { JSONObject live = journal(); if (live == null || !operation.equals(live.optString("operationId"))) removeFiles(operation); } throw changed; }
            if (!"capturing".equals(value.getString("state"))) { if (call != null) { authorize(owner,value); call.resolve(publicCapture(value,pageId,true)); } return; }
            getContext().revokeUriPermission(uri(operation), GRANTS);
            if (result.getResultCode() != Activity.RESULT_OK) { retire(value); throw new Failure(499, "CAPTURE_CANCELLED"); }
            boolean readyCommitted = false;
            try {
                // Private normalization can finish before a recreated WebView has loaded.
                // No bytes/metadata are exposed until the new page is authenticated.
                JSONObject prepared = normalize(value);
                synchronized (lock) { JSONObject live = current(value); live.put("prepared", prepared).put("state", "ready").put("revision", live.getLong("revision") + 1).put("restored", call == null || PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())); store(live); value = live; readyCommitted = true; }
                if (call != null && !PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())) { authorize(owner,value); call.resolve(publicCapture(value,pageId,false)); }
            } catch (Failure failure) {
                // After ready is durable, authorize itself retires only a verified
                // target/permission invalidation. Reload/about:blank, an unverified
                // identity or unavailable service must not discard the photograph.
                if (!readyCommitted && Arrays.asList("CAPTURE_INVALID_IMAGE","CAPTURE_FILE_MISSING","CAPTURE_EXPIRED").contains(failure.code)) retire(value);
                throw failure;
            }
        });
    }
    @PluginMethod public void getPending(PluginCall call) {
        run(call, () -> {
            fields(call.getData(), "identity,pageId", ""); JSONObject identity = identity(call.getData().getJSONObject("identity"), false); String pageId = id(call.getData().get("pageId"));
            JSONObject value; synchronized (lock) { value = journal(); }
            session(identity);
            if (value == null) { call.resolve(new JSObject().put("pending", false)); return; }
            if (!sameIdentity(identity, value.getJSONObject("owner"))) { retire(value); call.resolve(new JSObject().put("pending", false)); return; }
            synchronized (lock) { value = current(value); }
            authorize(value.getJSONObject("owner"), value);
            if (!file(value.getString("operationId"), ".raw.jpg").isFile() || "ready".equals(value.getString("state")) && !file(value.getString("operationId"), ".prepared.jpg").isFile()) { retire(value); throw new Failure(410, "CAPTURE_FILE_MISSING"); }
            synchronized (lock) { value = current(value); call.resolve(new JSObject().put("pending", true).put("capture", publicCapture(value, pageId, false))); }
        });
    }
    @PluginMethod public void read(PluginCall call) {
        run(call, () -> {
            fields(call.getData(), "owner,operationId", ""); JSONObject owner = identity(call.getData().getJSONObject("owner"), true); String operation = id(call.getData().get("operationId")); JSONObject value = match(owner, operation);
            if (!"ready".equals(value.getString("state"))) throw new Failure(409, "CAPTURE_NOT_READY");
            // Capacitor's optional JS bridge logger prints complete successful results.
            // Refuse image delivery under a logging-enabled build rather than log photos.
            if (getBridge().getConfig().isLoggingEnabled()) throw new Failure(503, "CAPTURE_UNAVAILABLE");
            authorize(owner, value); byte[] prepared;
            File source = file(operation, ".prepared.jpg"); if (!source.isFile()) { retire(value); throw new Failure(410, "CAPTURE_FILE_MISSING"); }
            try (InputStream input = new FileInputStream(source)) { prepared = bytes(input, MAX_PREPARED); }
            JSONObject metadata = value.getJSONObject("prepared");
            if (prepared.length != metadata.getLong("byteSize") || !sha(prepared).equals(metadata.getString("sha256"))) { retire(value); throw new Failure(410, "CAPTURE_FILE_MISSING"); }
            authorize(owner, value);
            synchronized (lock) {
                JSONObject live = current(value); if (live.getLong("revision") != value.getLong("revision")) throw new Failure(409, "CAPTURE_VERSION_CONFLICT");
                JSObject response = new JSObject(); for (String key : new String[]{"mimeType","byteSize","sha256","width","height"}) response.put(key, metadata.get(key));
                response.put("operationId", operation).put("revision", live.getLong("revision")).put("base64", Base64.encodeToString(prepared, Base64.NO_WRAP)); call.resolve(response);
            }
        });
    }
    private JSONObject media(JSONObject value) throws Exception {
        fields(value, "id,version,mimeType,byteSize,width,height", ""); JSONObject copy = new JSONObject(value.toString()).put("id", id(value.get("id")));
        number(value.get("version"), 1, SAFE); number(value.get("byteSize"), 1, MAX_PREPARED); number(value.get("width"), 1, 2048); number(value.get("height"), 1, 2048);
        if (!"image/webp".equals(value.get("mimeType"))) throw new Failure(400, "INVALID_ARGUMENT"); return copy;
    }
    private JSONObject mediaIntent(JSONObject value) throws Exception {
        fields(value, "allocateKey,uploadKey,completeKey", "mediaId,uploadSlotId,renewal"); JSONObject copy = new JSONObject();
        for (String key : new String[]{"allocateKey","uploadKey","completeKey","mediaId","uploadSlotId"}) if (value.has(key)) copy.put(key, id(value.get(key)));
        if (value.has("uploadSlotId") && !value.has("mediaId")) throw new Failure(400, "INVALID_ARGUMENT");
        if (value.has("renewal")) { JSONObject renewal = value.getJSONObject("renewal"); fields(renewal, "key,version,uploadKey,completeKey", ""); if (!value.has("mediaId")) throw new Failure(400,"INVALID_ARGUMENT"); JSONObject r = new JSONObject().put("version", number(renewal.get("version"), 1, SAFE)); for (String key : new String[]{"key","uploadKey","completeKey"}) r.put(key,id(renewal.get(key))); copy.put("renewal", r); }
        return copy;
    }
    private JSONObject plan(JSONObject value, JSONObject capture) throws Exception {
        fields(value, "photoIntent,messageAttempted", "mediaIntent"); if (!(value.get("messageAttempted") instanceof Boolean)) throw new Failure(400, "INVALID_ARGUMENT");
        JSONObject owner = capture.getJSONObject("owner"), photo = value.getJSONObject("photoIntent"); fields(photo, "personId,conversationId,clientMessageId,key,metadata", "media");
        JSONObject p = new JSONObject(); for (String key : new String[]{"personId","conversationId","clientMessageId","key"}) p.put(key,id(photo.get(key)));
        if (!p.getString("personId").equals(owner.getString("personId")) || !p.getString("conversationId").equals(owner.getString("conversationId")) || !p.getString("clientMessageId").equals(capture.getString("operationId")) || !p.getString("key").equals(capture.getString("operationId"))) throw new Failure(400, "INVALID_ARGUMENT");
        JSONObject metadata = photo.getJSONObject("metadata"), prepared = capture.getJSONObject("prepared"); fields(metadata,"mimeType,byteSize,sha256","");
        if (!prepared.getString("mimeType").equals(metadata.get("mimeType")) || !prepared.getString("sha256").equals(metadata.get("sha256")) || prepared.getLong("byteSize") != number(metadata.get("byteSize"),1,MAX_PREPARED)) throw new Failure(400,"INVALID_ARGUMENT");
        p.put("metadata", new JSONObject(metadata.toString())); if (photo.has("media")) p.put("media", media(photo.getJSONObject("media")));
        JSONObject result = new JSONObject().put("photoIntent",p).put("messageAttempted",value.getBoolean("messageAttempted"));
        if (value.has("mediaIntent")) result.put("mediaIntent",mediaIntent(value.getJSONObject("mediaIntent")));
        if (p.has("media") && (!result.has("mediaIntent") || !p.getJSONObject("media").getString("id").equals(result.getJSONObject("mediaIntent").optString("mediaId")))) throw new Failure(400,"INVALID_ARGUMENT");
        if (result.getBoolean("messageAttempted") && (!p.has("media") || !result.has("mediaIntent"))) throw new Failure(400,"INVALID_ARGUMENT"); return result;
    }
    private void transition(JSONObject old, JSONObject next) throws Exception {
        if (old == null) { if (next.getBoolean("messageAttempted")) throw new Failure(409,"CAPTURE_VERSION_CONFLICT"); return; }
        JSONObject a = old.getJSONObject("photoIntent"), b = next.getJSONObject("photoIntent");
        if (old.getBoolean("messageAttempted") && !next.getBoolean("messageAttempted") || a.has("media") && (!b.has("media") || !equal(a.getJSONObject("media"),b.getJSONObject("media")))) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        if (!old.has("mediaIntent")) return;
        if (!next.has("mediaIntent")) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        JSONObject x = old.getJSONObject("mediaIntent"), y = next.getJSONObject("mediaIntent");
        if (!x.getString("allocateKey").equals(y.getString("allocateKey")) || x.has("mediaId") && !x.getString("mediaId").equals(y.optString("mediaId"))) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        boolean sameKeys = x.getString("uploadKey").equals(y.getString("uploadKey")) && x.getString("completeKey").equals(y.getString("completeKey"));
        if (!sameKeys) {
            JSONObject renewal = x.optJSONObject("renewal");
            if (renewal == null || y.has("renewal") || !renewal.getString("uploadKey").equals(y.getString("uploadKey")) || !renewal.getString("completeKey").equals(y.getString("completeKey")) || !y.has("uploadSlotId")) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        } else {
            if (x.has("uploadSlotId") && !x.getString("uploadSlotId").equals(y.optString("uploadSlotId"))) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
            if (x.has("renewal") && (!y.has("renewal") || !equal(x.getJSONObject("renewal"),y.getJSONObject("renewal")))) throw new Failure(409,"CAPTURE_VERSION_CONFLICT");
        }
    }
    @PluginMethod public void checkpoint(PluginCall call) {
        run(call, () -> {
            fields(call.getData(),"owner,operationId,expectedRevision,plan",""); if (call.getData().toString().getBytes(StandardCharsets.UTF_8).length > 16384) throw new Failure(400,"INVALID_ARGUMENT");
            JSONObject owner = identity(call.getData().getJSONObject("owner"),true); String operation = id(call.getData().get("operationId")); long revision = number(call.getData().get("expectedRevision"),1,SAFE); JSONObject value = match(owner,operation);
            if (!"ready".equals(value.getString("state"))) throw new Failure(409,"CAPTURE_NOT_READY"); JSONObject next = plan(call.getData().getJSONObject("plan"),value); authorize(owner,value);
            synchronized (lock) {
                JSONObject live = current(value); long currentRevision = live.getLong("revision");
                if (currentRevision == revision + 1 && live.has("plan") && equal(live.getJSONObject("plan"),next)) { call.resolve(new JSObject().put("operationId",operation).put("revision",currentRevision)); return; }
                if (currentRevision != revision) throw new Failure(409,"CAPTURE_VERSION_CONFLICT"); transition(live.optJSONObject("plan"),next);
                live.put("plan",next).put("revision",currentRevision+1); store(live); call.resolve(new JSObject().put("operationId",operation).put("revision",currentRevision+1));
            }
        });
    }
    @PluginMethod public void release(PluginCall call) {
        try {
            fields(call.getData(),"owner,operationId,reason","receipt"); JSONObject owner = identity(call.getData().getJSONObject("owner"),true); String operation = id(call.getData().get("operationId")), reason = call.getString("reason");
            if (!Arrays.asList("sent","discard","owner_changed").contains(reason) || !"sent".equals(reason) && call.getData().has("receipt")) throw new Failure(400,"INVALID_ARGUMENT");
            page(origin()); JSONObject value;
            synchronized (lock) {
                value = cleanupJournal();
                if (value == null) { call.resolve(new JSObject().put("operationId",operation).put("cleared",true)); return; }
                if (!operation.equals(value.getString("operationId")) || !sameOwner(owner,value.getJSONObject("owner"))) { call.resolve(new JSObject().put("operationId",operation).put("cleared",false)); return; }
                if ("sent".equals(reason)) {
                    if (!call.getData().has("receipt") || !value.has("plan") || !value.getJSONObject("plan").getJSONObject("photoIntent").has("media")) throw new Failure(400,"INVALID_ARGUMENT");
                    JSONObject receipt = call.getData().getJSONObject("receipt"); fields(receipt,"messageId,conversationId,clientMessageId,mediaId,mediaVersion",""); id(receipt.get("messageId"));
                    JSONObject media = value.getJSONObject("plan").getJSONObject("photoIntent").getJSONObject("media");
                    if (!value.getJSONObject("plan").getBoolean("messageAttempted") || !id(receipt.get("conversationId")).equals(owner.getString("conversationId")) || !id(receipt.get("clientMessageId")).equals(operation) || !id(receipt.get("mediaId")).equals(media.getString("id")) || number(receipt.get("mediaVersion"),1,SAFE) != media.getLong("version")) throw new Failure(400,"INVALID_ARGUMENT");
                }
                value = tombstone(value);
            }
            JSONObject retired = value; run(call, () -> { retire(retired); call.resolve(new JSObject().put("operationId",operation).put("cleared",true)); });
        } catch (Exception error) { reject(call,error); }
    }
    @PluginMethod public void reconcileOwner(PluginCall call) {
        try {
            fields(call.getData(),"", "identity,expectedOwner,expectedOperationId"); if (!call.getData().has("identity")) throw new Failure(400,"INVALID_ARGUMENT"); page(origin());
            Object supplied = call.getData().opt("identity"); JSONObject identity = supplied == JSONObject.NULL ? null : identity(call.getData().getJSONObject("identity"),false);
            if (identity == null) {
                if (!call.getData().has("expectedOwner") || !call.getData().has("expectedOperationId")) { call.resolve(new JSObject().put("cleared",false)); return; }
                JSONObject expectedOwner = identity(call.getData().getJSONObject("expectedOwner"),true); String expectedOperation = id(call.getData().get("expectedOperationId")); JSONObject value;
                synchronized (lock) {
                    value = cleanupJournal();
                    if (value == null || !expectedOperation.equals(value.getString("operationId")) || !sameOwner(expectedOwner,value.getJSONObject("owner"))) { call.resolve(new JSObject().put("cleared",false)); return; }
                    value = tombstone(value);
                }
                JSONObject retired = value; run(call, () -> { retire(retired); call.resolve(new JSObject().put("cleared",true)); }); return;
            }
            if (call.getData().has("expectedOwner") || call.getData().has("expectedOperationId")) throw new Failure(400,"INVALID_ARGUMENT");
            run(call, () -> {
                session(identity); JSONObject value;
                synchronized (lock) { value = cleanupJournal(); if (value == null || sameIdentity(identity,value.getJSONObject("owner"))) { call.resolve(new JSObject().put("cleared",false)); return; } value = tombstone(value); }
                retire(value); call.resolve(new JSObject().put("cleared",true));
            });
        } catch (Exception failure) { reject(call,failure); }
    }
    @Override public void load() { run(null, () -> { JSONObject value; synchronized (lock) { value = cleanupJournal(); } if (value != null && (value.optBoolean("tombstone") || value.optLong("expiresAtMs",0) <= System.currentTimeMillis())) retire(value); }); }
    @Override protected Bundle saveInstanceState() {
        Bundle saved = super.saveInstanceState(); if (saved == null) saved = new Bundle();
        // Bridge already persists the bounded capture call identities. Durable files and
        // metadata remain private; never put image bytes or a native cookie in Bundle.
        saved.putBoolean("chatCaptureJournal",true); return saved;
    }
    @Override protected void restoreState(Bundle state) { restoredCaptureCall = state.getBoolean("chatCaptureJournal",false); }
    @Override protected void handleOnResume() {
        if (firstResumeHandled) return; firstResumeHandled = true;
        // Result callbacks registered for ON_START enqueue before this ON_RESUME
        // task. Only a genuinely fresh Activity with no restored capture call can
        // retire an abandoned external-wait lock; it never guesses a file is ready.
        run(null, () -> {
            synchronized (lock) {
                if (restoredCaptureCall || launchedByThisInstance != null) return;
                JSONObject waiting = camera(); if (waiting != null) clearCamera(waiting.getString("operationId"));
            }
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); /* Camera output and the journal survive process/Activity destruction. */ }
}
