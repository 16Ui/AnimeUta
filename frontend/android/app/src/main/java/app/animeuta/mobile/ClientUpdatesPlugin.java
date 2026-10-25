package app.animeuta.mobile;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ClientUpdates")
public class ClientUpdatesPlugin extends Plugin {
    @PluginMethod
    public void openDownload(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("https://server.example.invalid/downloads/android/AnimeUta.apk"));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open download", error);
        }
    }
}
