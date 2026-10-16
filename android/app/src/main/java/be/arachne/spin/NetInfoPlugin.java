package be.arachne.spin;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.Inet4Address;

/** Tells the page the phone's own IPv4 address on the wifi, so it knows which subnet to scan for the robot. */
@CapacitorPlugin(name = "NetInfo")
public class NetInfoPlugin extends Plugin {
    @PluginMethod
    public void getIp(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
            if (lp != null) for (LinkAddress a : lp.getLinkAddresses())
                if (a.getAddress() instanceof Inet4Address && !a.getAddress().isLoopbackAddress()) { ret.put("ip", a.getAddress().getHostAddress()); break; }
        } catch (Exception e) { ret.put("error", e.toString()); }
        call.resolve(ret);
    }
}
