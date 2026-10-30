package be.arachne.spin;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;

/** The servo adapter (Waveshare Bus Servo Adapter, CDC-ACM) plugged into the tablet: open at 1 Mbaud, then
 *  xfer = write one packet and read the reply in one call, so a servo read costs one bridge round trip. */
@CapacitorPlugin(name = "UsbSerial")
public class UsbSerialPlugin extends Plugin {
    private static final String ACTION = "be.arachne.spin.USB_PERMISSION";
    private UsbDeviceConnection conn;
    private UsbEndpoint in, out;

    private UsbManager mgr() { return (UsbManager) getContext().getSystemService(Context.USB_SERVICE); }

    private UsbDevice findAdapter() {
        for (UsbDevice d : mgr().getDeviceList().values()) {
            if (d.getVendorId() == 0x1a86) return d;                       // WCH (the Waveshare adapter's chip)
            for (int i = 0; i < d.getInterfaceCount(); i++)
                if (d.getInterface(i).getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA) return d;
        }
        return null;
    }

    /** Is the spin's adapter plugged in right now? (the launcher then jumps straight to usb.html) */
    @PluginMethod
    public void present(PluginCall call) { JSObject r = new JSObject(); r.put("present", findAdapter() != null); call.resolve(r); }

    @PluginMethod
    public void open(PluginCall call) {
        UsbDevice d = findAdapter();
        if (d == null) { call.reject("geen servo-adapter in de USB-poort"); return; }
        if (mgr().hasPermission(d)) { connect(call, d); return; }
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                getContext().unregisterReceiver(this);
                if (mgr().hasPermission(d)) connect(call, d); else call.reject("geen toestemming voor de USB-adapter");
            }
        };
        ContextCompat.registerReceiver(getContext(), r, new IntentFilter(ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
        int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        mgr().requestPermission(d, PendingIntent.getBroadcast(getContext(), 0, new Intent(ACTION).setPackage(getContext().getPackageName()), flags));
    }

    private synchronized void connect(PluginCall call, UsbDevice d) {
        close();
        UsbInterface ctrl = null, data = null;
        for (int i = 0; i < d.getInterfaceCount(); i++) {
            UsbInterface f = d.getInterface(i);
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_COMM && ctrl == null) ctrl = f;
            if (f.getInterfaceClass() == UsbConstants.USB_CLASS_CDC_DATA && data == null) data = f;
        }
        if (data == null) for (int i = 0; i < d.getInterfaceCount() && data == null; i++)
            if (d.getInterface(i).getEndpointCount() >= 2) data = d.getInterface(i);
        if (data == null) { call.reject("geen seriële interface op de adapter"); return; }
        conn = mgr().openDevice(d);
        if (conn == null) { call.reject("kan de USB-adapter niet openen"); return; }
        if (ctrl != null) conn.claimInterface(ctrl, true);
        conn.claimInterface(data, true);
        in = out = null;
        for (int i = 0; i < data.getEndpointCount(); i++) {
            UsbEndpoint e = data.getEndpoint(i);
            if (e.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
            if (e.getDirection() == UsbConstants.USB_DIR_IN) in = e; else out = e;
        }
        int baud = call.getInt("baud", 1000000), idx = (ctrl != null ? ctrl : data).getId();
        byte[] lc = {(byte) baud, (byte) (baud >> 8), (byte) (baud >> 16), (byte) (baud >> 24), 0, 0, 8};   // 8N1
        conn.controlTransfer(0x21, 0x20, 0, idx, lc, lc.length, 500);     // SET_LINE_CODING
        conn.controlTransfer(0x21, 0x22, 3, idx, null, 0, 500);           // SET_CONTROL_LINE_STATE: DTR + RTS
        drain();
        JSObject ret = new JSObject();
        ret.put("name", d.getProductName()); ret.put("vid", d.getVendorId()); ret.put("pid", d.getProductId());
        call.resolve(ret);
    }

    private void drain() { byte[] b = new byte[512]; while (conn.bulkTransfer(in, b, b.length, 5) > 0) { } }

    @PluginMethod
    public void xfer(PluginCall call) {
        synchronized (this) {
            if (conn == null || in == null || out == null) { call.reject("niet verbonden"); return; }
            byte[] pkt = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            int want = call.getInt("read", 0), timeout = call.getInt("timeout", 40);
            drain();
            if (conn.bulkTransfer(out, pkt, pkt.length, 200) < 0) { close(); call.reject("USB-verbinding weg"); return; }
            ByteArrayOutputStream got = new ByteArrayOutputStream();
            byte[] b = new byte[Math.max(64, in.getMaxPacketSize())];
            long end = System.currentTimeMillis() + timeout;
            while (got.size() < want && System.currentTimeMillis() < end) {
                int n = conn.bulkTransfer(in, b, b.length, (int) Math.max(1, end - System.currentTimeMillis()));
                if (n > 0) got.write(b, 0, n);
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(got.toByteArray(), Base64.NO_WRAP));
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void close(PluginCall call) { close(); call.resolve(); }

    private synchronized void close() { if (conn != null) { conn.close(); conn = null; } }
}
