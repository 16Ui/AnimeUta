package app.animeuta.mobile;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SavedCredentialsTest {
    private static final String SERVER = "https://native-credential-test.invalid";
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    private SavedCredentialsPlugin plugin() {
        return new SavedCredentialsPlugin() { @Override public Context getContext() { return context; } };
    }
    static class Call extends PluginCall {
        JSObject result;
        String error;
        boolean completed;
        Call(JSObject data) { super(null, "SavedCredentials", "test", "test", data); }
        @Override public void resolve() { completed = true; }
        @Override public void resolve(JSObject data) { result = data; completed = true; }
        @Override public void reject(String message) { error = message; completed = true; }
        void check() { assertTrue(completed); assertNull(error); }
    }
    private Call call(String server) { return new Call(new JSObject().put("server", server)); }

    @Test public void savePhase() throws Exception {
        Call save = new Call(new JSObject().put("server", SERVER).put("email", "qa@example.invalid").put("password", "Native-test-password-123"));
        plugin().save(save); save.check();
        String stored = context.getSharedPreferences("saved-logins", Context.MODE_PRIVATE).getString(SERVER, null);
        assertNotNull(stored);
        assertFalse(stored.contains("Native-test-password"));
        Call other = call(SERVER + "/other"); plugin().load(other); other.check();
        assertTrue(other.result.isNull("login"));
    }

    @Test public void restorePhase() throws Exception {
        Call load = call(SERVER); plugin().load(load); load.check();
        JSONObject login = load.result.getJSONObject("login");
        assertEquals("Native-test-password-123", login.getString("password"));
        assertEquals("qa@example.invalid", login.getString("email"));
        Call remove = call(SERVER); plugin().remove(remove); remove.check();
        Call missing = call(SERVER); plugin().load(missing); missing.check();
        assertTrue(missing.result.isNull("login"));
    }
}
