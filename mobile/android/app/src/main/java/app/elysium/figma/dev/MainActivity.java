package app.elysium.figma.dev;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(WindowSurfacePlugin.class);
        super.onCreate(savedInstanceState);
        // Android's IME handling retains priority; this only handles app-level back.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            private boolean checkingBack;

            private void delegateToHost() {
                setEnabled(false);
                try {
                    getOnBackPressedDispatcher().onBackPressed();
                } finally {
                    setEnabled(true);
                }
            }

            @Override
            public void handleOnBackPressed() {
                if (checkingBack) return;
                if (bridge == null || bridge.getWebView() == null) {
                    delegateToHost();
                    return;
                }
                checkingBack = true;
                try {
                    bridge.getWebView().evaluateJavascript(
                        "(function(){try{return typeof window.__xijieNativeBack==='function' && " +
                        "window.__xijieNativeBack()===true;}catch(error){return false;}})()",
                        value -> {
                            checkingBack = false;
                            if (!"true".equals(value) && !isFinishing() && !isDestroyed()) {
                                delegateToHost();
                            }
                        }
                    );
                } catch (RuntimeException unavailableWebView) {
                    checkingBack = false;
                    delegateToHost();
                }
            }
        });
    }
}
