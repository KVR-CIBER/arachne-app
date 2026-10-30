package be.arachne.spin;

import android.content.Intent;
import android.hardware.usb.UsbManager;
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
        registerPlugin(UsbSerialPlugin.class);
        registerPlugin(LiveUpdatePlugin.class);
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // screen stays on while driving
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // spin plugged in while the app is open: straight to the USB page
        if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(intent.getAction()) && getBridge() != null)
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(getBridge().getLocalUrl() + "/usb.html?app"));
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
