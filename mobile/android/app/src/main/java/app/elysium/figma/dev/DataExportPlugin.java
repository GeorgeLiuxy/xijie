package app.elysium.figma.dev;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.util.JsonReader;
import android.util.JsonToken;
import androidx.activity.result.ActivityResult;
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
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;

/** Saves only the current session's first-party data-rights export. No document body crosses the bridge. */
@CapacitorPlugin(name = "DataExport")
public class DataExportPlugin extends Plugin {
    private static final String UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    private static final long MAX_BYTES = 64L * 1024 * 1024;
    private static final String JOURNAL = "xijie_data_export";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicReference<Job> active = new AtomicReference<>();
    private final AtomicBoolean chooserOutstanding = new AtomicBoolean();

    private static class Failure extends Exception {
        final int status; final String code;
        Failure(int status, String code) { this.status = status; this.code = code; }
    }
    private static class Digest {
        final long bytes; final String sha;
        Digest(long bytes, String sha) { this.bytes = bytes; this.sha = sha; }
    }
    private static class Job {
        final PluginCall call; final String request, grant, session, operation, name, origin;
        final AtomicBoolean cancelled = new AtomicBoolean(), settled = new AtomicBoolean();
        volatile HttpURLConnection connection;
        volatile boolean choosing, chooserStarted, committed;
        volatile Uri target;
        volatile boolean media;
        File temporary;
        String cookie;
        Digest downloaded;
        Job(PluginCall call, String request, String grant, String session, String operation, String origin) {
            this.call = call; this.request = request; this.grant = grant; this.session = session; this.operation = operation; this.origin = origin;
            this.name = "xijie-data-" + request + ".json";
        }
    }
    private interface MainWork<T> { T run() throws Exception; }
    private <T> T onMain(MainWork<T> work) throws Exception {
        if (Looper.myLooper() == Looper.getMainLooper()) return work.run();
        AtomicReference<T> value = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        CountDownLatch ready = new CountDownLatch(1);
        getBridge().executeOnMainThread(() -> { try { value.set(work.run()); } catch (Exception error) { failure.set(error); } finally { ready.countDown(); } });
        if (!ready.await(5, TimeUnit.SECONDS)) throw new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
        if (failure.get() != null) throw failure.get();
        return value.get();
    }
    private String id(PluginCall call, String key) throws Failure {
        String value = call.getString(key);
        if (value == null || !value.matches(UUID)) throw new Failure(400, "INVALID_ARGUMENT");
        return value.toLowerCase(java.util.Locale.ROOT);
    }
    private String origin() throws Exception {
        String source = getBridge().getConfig().getServerUrl();
        if (source == null) throw new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
        URI uri = new URI(source);
        boolean secure = "https".equals(uri.getScheme());
        // This app does not generate BuildConfig; the installed manifest's debug flag is authoritative.
        boolean debug = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0
            && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && uri.getPort() > 0 && uri.getPort() <= 65535;
        if ((!secure && !debug) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
            || !(uri.getRawPath() == null || uri.getRawPath().isEmpty() || uri.getRawPath().equals("/")) || uri.getPort() > 65535 || uri.getPort() == 0) throw new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
        int port = secure && uri.getPort() == 443 ? -1 : uri.getPort();
        return new URI(uri.getScheme(), null, uri.getHost().toLowerCase(java.util.Locale.ROOT), port, null, null, null).toASCIIString();
    }
    private int port(URI uri) { return uri.getPort() >= 0 ? uri.getPort() : "https".equals(uri.getScheme()) ? 443 : 80; }
    private boolean knownOutdatedWebView() {
        // API24/25 cannot identify the active provider reliably. Vendor version numbers
        // also need not be Chromium majors, so do not infer an upgrade from those.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            PackageInfo info = WebView.getCurrentWebViewPackage();
            if (info == null || info.packageName == null || info.versionName == null) return false;
            boolean chromium = info.packageName.equals("com.android.chrome") || info.packageName.equals("com.android.webview")
                || info.packageName.matches("com\\.google\\.android\\.webview(?:\\.(?:beta|dev|canary))?")
                || info.packageName.matches("com\\.chrome\\.(?:beta|dev|canary)");
            if (!chromium || !info.versionName.matches("[1-9][0-9]{0,3}(?:\\.[0-9]+){1,3}")) return false;
            int major = Integer.parseInt(info.versionName.substring(0, info.versionName.indexOf('.')));
            // Chrome69 is verified to hide SameSite cookies from CookieManager; the
            // Chromium74 reader explicitly includes them. This is export-specific.
            return major < 74;
        } catch (RuntimeException unavailableProvider) { return false; }
    }
    private String currentCookie(Job job) throws Exception {
        return onMain(() -> {
            Activity activity = getActivity();
            String page = getBridge().getWebView().getUrl();
            if (activity == null || activity.isFinishing() || activity.isDestroyed() || page == null) throw new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
            URI wanted = new URI(job.origin), shown = new URI(page);
            if (shown.getHost() == null || shown.getRawUserInfo() != null || !wanted.getScheme().equals(shown.getScheme())
                || !wanted.getHost().equalsIgnoreCase(shown.getHost()) || port(wanted) != port(shown)) throw new Failure(401, "UNAUTHENTICATED");
            String cookie = CookieManager.getInstance().getCookie(job.origin + "/v1/accounts/me/data-requests/" + job.request + "/content");
            if (cookie == null || cookie.isEmpty()) {
                if (knownOutdatedWebView()) throw new Failure(503, "EXPORT_WEBVIEW_OUTDATED");
                throw new Failure(401, "UNAUTHENTICATED");
            }
            if (cookie.indexOf('\r') >= 0 || cookie.indexOf('\n') >= 0) throw new Failure(401, "UNAUTHENTICATED");
            return cookie;
        });
    }
    private void check(Job job) throws Failure {
        if (job.cancelled.get() || active.get() != job || Thread.currentThread().isInterrupted()) throw new Failure(499, "EXPORT_CANCELLED");
    }
    private HttpURLConnection connect(Job job, String path) throws Exception {
        check(job);
        HttpURLConnection connection = (HttpURLConnection) new URL(job.origin + path).openConnection();
        job.connection = connection;
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setUseCaches(false);
        connection.setRequestMethod("GET");
        connection.setRequestProperty("Cookie", job.cookie);
        connection.setRequestProperty("X-Xijie-Expected-Session", job.session);
        connection.setRequestProperty("Origin", job.origin);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        int status = connection.getResponseCode(); check(job);
        if (status != 200) {
            String code = status >= 300 && status < 400 ? "EXPORT_REDIRECT_REJECTED" : "EXPORT_DOWNLOAD_FAILED";
            try (InputStream error = connection.getErrorStream()) {
                if (error != null) {
                    String candidate = new JSONObject(new String(small(error, 8192), StandardCharsets.UTF_8)).optJSONObject("error").optString("code");
                    if (candidate.matches("[A-Z][A-Z0-9_]{1,79}")) code = candidate;
                }
            } catch (Exception ignored) { /* A bounded, known error code is the only response detail returned. */ }
            throw new Failure(status >= 400 && status <= 599 ? status : 502, code);
        }
        String mime = connection.getContentType();
        if (mime == null || !mime.split(";", 2)[0].trim().equalsIgnoreCase("application/json")) throw new Failure(502, "INVALID_RESPONSE");
        if (connection.getContentLengthLong() > MAX_BYTES) throw new Failure(413, "EXPORT_TOO_LARGE");
        return connection;
    }
    private byte[] small(InputStream input, int maximum) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[1024]; int count;
        while ((count = input.read(buffer)) != -1) { if (output.size() + count > maximum) throw new Failure(502, "INVALID_RESPONSE"); output.write(buffer, 0, count); }
        return output.toByteArray();
    }
    private String hex(byte[] value) { StringBuilder text = new StringBuilder(); for (byte item : value) text.append(String.format(java.util.Locale.ROOT, "%02x", item & 255)); return text.toString(); }
    private Digest copy(Job job, InputStream input, OutputStream output) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[32768]; long total = 0; int count;
        while ((count = input.read(buffer)) != -1) {
            check(job); total += count;
            if (total > MAX_BYTES) throw new Failure(413, "EXPORT_TOO_LARGE");
            if (output != null) output.write(buffer, 0, count);
            digest.update(buffer, 0, count);
        }
        check(job);
        if (total == 0) throw new Failure(502, "INVALID_RESPONSE");
        return new Digest(total, hex(digest.digest()));
    }
    private Digest write(Job job, InputStream input) throws Exception {
        ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(job.target, "wt");
        if (descriptor == null) throw new Failure(503, "EXPORT_SAVE_FAILED");
        try (ParcelFileDescriptor.AutoCloseOutputStream output = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) {
            Digest result = copy(job, input, output); output.flush();
            // SAF providers can return a pipe; close + readback is its completion contract.
            if (job.media) output.getFD().sync();
            return result;
        }
    }
    private void remember(Job job) throws Failure {
        if (!getContext().getSharedPreferences(JOURNAL, 0).edit().putString("pending", job.target.toString()).putBoolean("media", job.media).putBoolean("complete", false).commit()) throw new Failure(503, "EXPORT_SAVE_FAILED");
    }
    private void clearJournal(Job job) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences(JOURNAL, 0);
        if (job.target != null && job.target.toString().equals(prefs.getString("pending", null))) prefs.edit().clear().commit();
    }
    private void delete(Uri uri, boolean media) {
        if (uri == null || !"content".equals(uri.getScheme())) return;
        try { if (media) getContext().getContentResolver().delete(uri, null, null); else DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); } catch (Exception ignored) { /* Never broaden deletion beyond this operation's created URI. */ }
    }
    private void finish(Job job, Failure failure, JSObject result) {
        if (!job.settled.compareAndSet(false, true)) return;
        HttpURLConnection connection = job.connection; if (connection != null) connection.disconnect();
        if (!job.committed) delete(job.target, job.media);
        if (job.temporary != null) job.temporary.delete();
        clearJournal(job); active.compareAndSet(job, null);
        if (failure == null) job.call.resolve(result);
        else job.call.reject("The export file could not be saved.", failure.code, new JSObject().put("status", failure.status));
        job.call.release(getBridge());
    }
    private Failure failure(Exception error, Job job) { return error instanceof Failure ? (Failure) error : new Failure(job.cancelled.get() ? 499 : 503, job.cancelled.get() ? "EXPORT_CANCELLED" : "EXPORT_SAVE_FAILED"); }
    private String displayName(Job job) throws Exception {
        try (Cursor cursor = getContext().getContentResolver().query(job.target, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor == null || !cursor.moveToFirst()) throw new Failure(503, "EXPORT_SAVE_FAILED");
            String name = cursor.getString(0);
            if (name == null || name.trim().isEmpty() || name.length() > 255 || name.matches(".*[\\p{Cntrl}/\\\\].*")) throw new Failure(502, "INVALID_RESPONSE");
            return name;
        }
    }
    private void verifySession(Job job) throws Exception {
        check(job);
        if (!job.cookie.equals(currentCookie(job))) throw new Failure(401, "UNAUTHENTICATED");
        HttpURLConnection connection = connect(job, "/v1/sessions/current");
        try (InputStream input = connection.getInputStream()) {
            JSONObject session = new JSONObject(new String(small(input, 8192), StandardCharsets.UTF_8)).getJSONObject("data");
            if (!job.session.equals(session.optString("id"))) throw new Failure(401, "UNAUTHENTICATED");
        } finally { connection.disconnect(); job.connection = null; }
    }
    private void publish(Job job) throws Exception {
        Digest saved;
        try (InputStream input = getContext().getContentResolver().openInputStream(job.target)) {
            if (input == null) throw new Failure(503, "EXPORT_SAVE_FAILED");
            saved = copy(job, input, null);
        }
        if (saved.bytes != job.downloaded.bytes || !saved.sha.equals(job.downloaded.sha)) throw new Failure(502, "EXPORT_INTEGRITY_FAILED");
        // A truncated, chunked HTTP response must not become a successfully saved JSON export.
        try (InputStream input = getContext().getContentResolver().openInputStream(job.target)) {
            if (input == null) throw new Failure(503, "EXPORT_SAVE_FAILED");
            try (JsonReader json = new JsonReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                boolean request = false, schema = false;
                json.beginObject();
                while (json.hasNext()) {
                    check(job); String key = json.nextName();
                    if (key.equals("requestId")) { if (request || !job.request.equals(json.nextString())) throw new Failure(502, "EXPORT_INTEGRITY_FAILED"); request = true; }
                    else if (key.equals("schemaVersion")) { if (schema || json.nextInt() != 1) throw new Failure(502, "EXPORT_INTEGRITY_FAILED"); schema = true; }
                    else json.skipValue();
                }
                json.endObject();
                if (!request || !schema || json.peek() != JsonToken.END_DOCUMENT) throw new Failure(502, "EXPORT_INTEGRITY_FAILED");
            }
        }
        String name = displayName(job);
        verifySession(job);
        synchronized (job) {
            check(job);
            if (job.media) {
                ContentValues visible = new ContentValues(); visible.put(MediaStore.Downloads.IS_PENDING, 0);
                if (getContext().getContentResolver().update(job.target, visible, null, null) != 1) throw new Failure(503, "EXPORT_SAVE_FAILED");
            }
            // A crash after successful SAF output must never make a later launch delete that completed file.
            if (!getContext().getSharedPreferences(JOURNAL, 0).edit().putBoolean("complete", true).commit()) throw new Failure(503, "EXPORT_SAVE_FAILED");
            job.committed = true;
        }
        finish(job, null, new JSObject().put("fileName", name).put("bytes", saved.bytes).put("sha256", saved.sha));
    }
    private void download(Job job) {
        try {
            check(job); job.cookie = currentCookie(job);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues(); values.put(MediaStore.Downloads.DISPLAY_NAME, job.name); values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/"); values.put(MediaStore.Downloads.IS_PENDING, 1);
                job.media = true;
                job.target = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (job.target == null) throw new Failure(503, "EXPORT_SAVE_FAILED"); remember(job);
            }
            HttpURLConnection connection = connect(job, "/v1/accounts/me/data-requests/" + job.request + "/content?grant=" + job.grant);
            try (InputStream input = connection.getInputStream()) {
                if (job.media) job.downloaded = write(job, input);
                else {
                    job.temporary = File.createTempFile("xijie-export-", ".tmp", getContext().getCacheDir());
                    try (FileOutputStream output = new FileOutputStream(job.temporary)) { job.downloaded = copy(job, input, output); output.flush(); output.getFD().sync(); }
                }
            } finally { connection.disconnect(); job.connection = null; }
            if (job.media) publish(job);
            else {
                check(job); job.choosing = true;
                onMain(() -> {
                    check(job);
                    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("application/json"); intent.putExtra(Intent.EXTRA_TITLE, job.name);
                    Activity activity = getActivity();
                    if (activity == null || activity.isFinishing() || activity.isDestroyed() || intent.resolveActivity(activity.getPackageManager()) == null) throw new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
                    chooserOutstanding.set(true);
                    startActivityForResult(job.call, intent, "chosenDestination"); job.chooserStarted = true; return null;
                });
            }
        } catch (Exception error) { if (!job.chooserStarted) chooserOutstanding.set(false); finish(job, failure(error, job), null); }
    }
    @PluginMethod public void save(PluginCall call) {
        Job started = null;
        try {
            // Capacitor associates activity results by its last saved call, even after a cancellation.
            if (chooserOutstanding.get()) throw new Failure(409, "REQUEST_IN_PROGRESS");
            Job job = new Job(call, id(call, "requestId"), id(call, "grantId"), id(call, "expectedSessionId"), id(call, "operationId"), origin());
            if (!active.compareAndSet(null, job)) throw new Failure(409, "REQUEST_IN_PROGRESS");
            started = job;
            worker.execute(() -> download(job));
        } catch (Exception error) {
            Failure issue = error instanceof Failure ? (Failure) error : new Failure(503, "NATIVE_EXPORT_UNAVAILABLE");
            if (started != null) finish(started, issue, null);
            else call.reject("The export file could not be saved.", issue.code, new JSObject().put("status", issue.status));
        }
    }
    @PluginMethod public void cancel(PluginCall call) {
        try {
            String operation = id(call, "operationId"), session = id(call, "expectedSessionId"); Job job = active.get();
            if (job != null && job.operation.equals(operation) && job.session.equals(session)) {
                synchronized (job) { if (!job.committed) job.cancelled.set(true); }
                HttpURLConnection connection = job.connection; if (connection != null) connection.disconnect();
                if (job.choosing) worker.execute(() -> finish(job, new Failure(499, "EXPORT_CANCELLED"), null));
            }
            call.resolve();
        } catch (Exception ignored) { call.reject("Invalid export cancellation.", "INVALID_ARGUMENT"); }
    }
    @ActivityCallback private void chosenDestination(PluginCall call, ActivityResult result) {
        chooserOutstanding.set(false);
        Job job = active.get(); Uri uri = result.getData() == null ? null : result.getData().getData();
        if (job == null || call == null || !job.operation.equals(call.getString("operationId"))) { if (uri != null) delete(uri, false); return; }
        job.choosing = false;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || !"content".equals(uri.getScheme())) { if (uri != null) delete(uri, false); worker.execute(() -> finish(job, new Failure(499, "EXPORT_CANCELLED"), null)); return; }
        job.target = uri;
        worker.execute(() -> {
            try {
                check(job); remember(job); verifySession(job);
                try (InputStream input = new FileInputStream(job.temporary)) {
                    Digest copied = write(job, input);
                    if (copied.bytes != job.downloaded.bytes || !copied.sha.equals(job.downloaded.sha)) throw new Failure(502, "EXPORT_INTEGRITY_FAILED");
                }
                publish(job);
            } catch (Exception error) { finish(job, failure(error, job), null); }
        });
    }
    @Override public void load() {
        worker.execute(() -> {
            android.content.SharedPreferences prefs = getContext().getSharedPreferences(JOURNAL, 0); String pending = prefs.getString("pending", null);
            if (pending != null && !prefs.getBoolean("complete", false)) {
                Uri uri = Uri.parse(pending); boolean media = prefs.getBoolean("media", false);
                if (media && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { MediaStore.Downloads.IS_PENDING }, null, null, null)) { if (cursor != null && cursor.moveToFirst() && cursor.getInt(0) == 1) delete(uri, true); } catch (Exception ignored) { }
                } else delete(uri, false);
            }
            prefs.edit().clear().commit();
            File[] files = getContext().getCacheDir().listFiles((dir, name) -> name.matches("xijie-export-[0-9]+\\.tmp"));
            if (files != null) for (File file : files) file.delete();
        });
    }
    @Override protected void handleOnDestroy() {
        Job job = active.get();
        if (job != null) { synchronized (job) { if (!job.committed) job.cancelled.set(true); } if (job.connection != null) job.connection.disconnect(); worker.execute(() -> finish(job, new Failure(499, "EXPORT_CANCELLED"), null)); }
        worker.shutdown();
    }
}
