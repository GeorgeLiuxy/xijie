package app.elysium.figma.dev;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Shared only with the SDK callback Activity. Provider credentials never cross the JS bridge. */
final class NativeAuthState {
    static final Object LOCK = new Object();
    static final String UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    static final String PROOF_PATTERN = "[A-Za-z0-9_-]{43}";
    private static final String ALIAS = "xijie.native.auth.pending.v1";
    private static final int MAXIMUM = 16384;
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("xijie_native_auth", Context.MODE_PRIVATE); }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    static void save(Context context, JSONObject value) throws Exception {
        synchronized (LOCK) {
            byte[] plain = value.toString().getBytes(StandardCharsets.UTF_8);
            if (plain.length > MAXIMUM) throw new Exception("Private authorization storage unavailable");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(plain), Base64.NO_WRAP);
            SharedPreferences storage = prefs(context); String previous = storage.getString("pending", null);
            if (!storage.edit().putString("pending", encoded).commit()) {
                // commit(false) can still alter SharedPreferences' in-memory map. Never acknowledge it.
                SharedPreferences.Editor rollback = storage.edit();
                if (previous == null) rollback.remove("pending"); else rollback.putString("pending", previous);
                rollback.commit();
                throw new Exception("Private authorization storage unavailable");
            }
        }
    }

    static void clear(Context context) throws Exception {
        synchronized (LOCK) {
            SharedPreferences storage = prefs(context); String previous = storage.getString("pending", null);
            if (!storage.edit().remove("pending").commit()) {
                if (previous != null) storage.edit().putString("pending", previous).commit();
                throw new Exception("Private authorization storage unavailable");
            }
        }
    }

    static JSONObject pending(Context context) throws Exception {
        synchronized (LOCK) {
            String encoded = prefs(context).getString("pending", null); if (encoded == null) return null;
            JSONObject value;
            try {
                if (encoded.length() > MAXIMUM * 2) throw new Exception("Invalid private authorization");
                String[] parts = encoded.split(":", -1); if (parts.length != 2) throw new Exception("Invalid private authorization");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                byte[] decoded = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
                if (decoded.length > MAXIMUM) throw new Exception("Invalid private authorization");
                value = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
                if (!value.optString("startKey").matches(UUID_PATTERN) || !value.optString("redeemKey").matches(UUID_PATTERN)
                    || !value.optString("verifier").matches(PROOF_PATTERN) || !value.optString("launchProof").matches(PROOF_PATTERN)
                    || !value.optString("verifierChallenge").matches("[0-9a-f]{64}")) throw new Exception("Invalid private authorization");
                String provider = value.optString("provider"), purpose = value.optString("purpose"), transport = value.optString("transport", "browser");
                if (!(provider.equals("apple") || provider.equals("google") || provider.equals("wechat"))
                    || !(purpose.equals("sign_in") || purpose.equals("switch") || purpose.equals("reauthenticate"))
                    || !(transport.equals("browser") || transport.equals("wechat_sdk")) || transport.equals("wechat_sdk") && !provider.equals("wechat")) throw new Exception("Invalid private authorization");
                for (String field : new String[]{"expectedSessionId", "previousAccountId", "attemptId", "generation", "launchKey", "completeKey"})
                    if (value.has(field) && !value.isNull(field) && !value.optString(field).matches(UUID_PATTERN)) throw new Exception("Invalid private authorization");
                if (purpose.equals("reauthenticate") && (value.isNull("expectedSessionId") || value.isNull("previousAccountId")
                    || !value.has("expectedSessionId") || !value.has("previousAccountId"))) throw new Exception("Invalid private authorization");
                if (value.has("ticket") && !value.optString("ticket").matches(PROOF_PATTERN)) throw new Exception("Invalid private authorization");
                if (value.has("authState") && !value.optString("authState").matches(PROOF_PATTERN)) throw new Exception("Invalid private authorization");
                if (value.has("authCode") && !validCode(value.optString("authCode"))) throw new Exception("Invalid private authorization");
                if (value.has("failureCode") && !validFailure(value.optString("failureCode"))) throw new Exception("Invalid private authorization");
                if (value.has("stage") && !value.optString("stage").matches("prepared|waiting_provider|callback_received|completing|verified|failed")) throw new Exception("Invalid private authorization");
            } catch (Exception corrupt) { clear(context); throw new Exception("Private authorization unavailable"); }
            if (value.optLong("expiresAt", 0) <= System.currentTimeMillis()) { clear(context); return null; }
            // Migrate the old browser-only journal without replacing any original ownership proof.
            boolean migrated = false;
            for (String field : new String[]{"generation", "launchKey", "completeKey"}) if (!value.has(field)) { value.put(field, UUID.randomUUID().toString()); migrated = true; }
            if (!value.has("transport")) { value.put("transport", "browser"); migrated = true; }
            if (!value.has("stage")) { value.put("stage", value.has("ticket") ? "verified" : value.optBoolean("failed") ? "failed" : value.has("attemptId") ? "waiting_provider" : "prepared"); migrated = true; }
            try {
                String stage = value.getString("stage");
                if ((value.has("expectedSessionId") && !value.isNull("expectedSessionId")) != (value.has("previousAccountId") && !value.isNull("previousAccountId"))) throw new Exception("Invalid private authorization");
                if (!stage.equals("prepared") && !value.optString("attemptId").matches(UUID_PATTERN)) throw new Exception("Invalid private authorization");
                if (stage.equals("verified") != value.has("ticket")) throw new Exception("Invalid private authorization");
                if (value.optString("transport").equals("wechat_sdk")) {
                    boolean needsState = stage.equals("waiting_provider") || stage.equals("callback_received") || stage.equals("completing");
                    if (needsState && (!value.optString("appId").matches("wx[0-9a-fA-F]{16}") || !value.optString("authState").matches(PROOF_PATTERN))) throw new Exception("Invalid private authorization");
                    if ((stage.equals("callback_received") || stage.equals("completing")) && !validCode(value.optString("authCode"))) throw new Exception("Invalid private authorization");
                    if (!needsState && (value.has("authCode") || value.has("authState") || value.has("appId"))) throw new Exception("Invalid private authorization");
                } else if (value.has("authCode") || value.has("authState") || value.has("appId")) throw new Exception("Invalid private authorization");
            } catch (Exception corrupt) { clear(context); throw new Exception("Private authorization unavailable"); }
            if (migrated) save(context, value);
            return value;
        }
    }

    static boolean same(JSONObject a, JSONObject b) {
        return a != null && b != null && a.optString("generation").equals(b.optString("generation")) && a.optString("startKey").equals(b.optString("startKey"));
    }
    static boolean validCode(String value) { return value != null && value.matches("[A-Za-z0-9_\\-]{1,512}"); }
    static boolean validFailure(String value) {
        return value != null && value.matches("AUTH_CANCELLED|AUTH_DENIED|AUTH_PROVIDER_UNAVAILABLE|AUTH_RESTART_REQUIRED|AUTH_RESULT_UNKNOWN|IDENTITY_SCOPE_CHANGED|AUTH_WECHAT_NOT_INSTALLED|AUTH_WECHAT_NOT_CONFIGURED|AUTH_SDK_LAUNCH_FAILED|AUTH_SERVICE_UNAVAILABLE|AUTH_WEBVIEW_OUTDATED");
    }
    static void fail(JSONObject value, String code) throws Exception {
        if (!validFailure(code)) throw new Exception("Invalid authorization failure");
        value.put("stage", "failed").put("failed", true).put("failureCode", code);
        value.remove("authCode"); value.remove("authState"); value.remove("appId"); value.remove("ticket");
    }
    private NativeAuthState() {}
}
