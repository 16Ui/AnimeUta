package app.animeuta.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

@CapacitorPlugin(name = "SavedCredentials")
public class SavedCredentialsPlugin extends Plugin {
    private static final String ALIAS = "animeuta.saved-logins.v1";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences("saved-logins", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }

    private String server(PluginCall call) {
        String value = call.getString("server");
        if (value == null || value.isEmpty()) throw new IllegalArgumentException("server_required");
        return value;
    }

    @PluginMethod public void save(PluginCall call) {
        try {
            String server = server(call);
            String email = call.getString("email");
            String password = call.getString("password");
            if (email == null || email.isEmpty() || password == null || password.isEmpty()) throw new IllegalArgumentException();
            JSONObject login = new JSONObject().put("email", email).put("password", password);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            cipher.updateAAD(server.getBytes(StandardCharsets.UTF_8));
            JSONObject entry = new JSONObject()
                .put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .put("cipher", Base64.encodeToString(cipher.doFinal(login.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
            if (!prefs().edit().putString(server, entry.toString()).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) { call.reject("credential_save_failed"); }
    }

    @PluginMethod public void load(PluginCall call) {
        try {
            String server = server(call);
            String value = prefs().getString(server, null);
            JSObject result = new JSObject();
            if (value == null) { result.put("login", JSONObject.NULL); call.resolve(result); return; }
            JSONObject entry = new JSONObject(value);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(entry.getString("iv"), Base64.NO_WRAP)));
            cipher.updateAAD(server.getBytes(StandardCharsets.UTF_8));
            String login = new String(cipher.doFinal(Base64.decode(entry.getString("cipher"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
            result.put("login", new JSONObject(login));
            call.resolve(result);
        } catch (Exception error) { call.reject("credential_load_failed"); }
    }

    @PluginMethod public void remove(PluginCall call) {
        try {
            if (!prefs().edit().remove(server(call)).commit()) throw new IllegalStateException();
            call.resolve();
        } catch (Exception error) { call.reject("credential_delete_failed"); }
    }
}
