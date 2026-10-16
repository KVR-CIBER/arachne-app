package be.arachne.spin;

import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NetInfoPlugin.class);
        registerPlugin(VoicePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // screen stays on while driving
    }

    private static boolean fromPad(KeyEvent e) {
        int s = e.getSource();
        return (s & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (s & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        // Controller buttons go to the page (Gamepad API). Android would otherwise turn B into "back" and leave the simulation.
        if (fromPad(e)) {
            if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().dispatchKeyEvent(e);
            return true;
        }
        return super.dispatchKeyEvent(e);
    }
}
