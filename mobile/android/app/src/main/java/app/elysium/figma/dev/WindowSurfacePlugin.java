package app.elysium.figma.dev;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WindowSurface")
public class WindowSurfacePlugin extends Plugin {
    @PluginMethod
    public void setBackground(PluginCall call) {
        String color = call.getString("color");
        if (color == null || !color.matches("#[0-9a-fA-F]{6}")) {
            call.reject("Expected a color in #RRGGBB format.");
            return;
        }
        final int surfaceColor = Color.parseColor(color);
        getBridge().executeOnMainThread(() -> {
            Activity activity = getActivity();
            if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                call.reject("Window is not available.");
                return;
            }
            Window window = activity.getWindow();
            window.getDecorView().setBackgroundColor(surfaceColor);
            if (Build.VERSION.SDK_INT < 35) {
                window.setStatusBarColor(surfaceColor);
                window.setNavigationBarColor(surfaceColor);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.setNavigationBarContrastEnforced(false);
                }
            }
            call.resolve();
        });
    }
}
