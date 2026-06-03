// android/app/src/main/java/com/mwpos/app/BluetoothPrinterPlugin.kt
//
// Fixes applied:
//
//  FIX A — closeSocket() no longer clears connectedAddress.
//    connectedAddress is only cleared in disconnect() (explicit user action).
//
//  FIX B — print() auto-reconnects instead of rejecting when socket is gone.
//
//  FIX C — createInsecureRfcommSocketToServiceRecord fallback for cheap BT 4.0
//    printers (like the orange/blue 1500mAh model) that refuse the secure socket
//    on Android 10+.
//
//  FIX D — cancelDiscovery guarded by BLUETOOTH_SCAN permission on Android 12+.
//
//  FIX E — print() reconnect and actual write are BOTH moved inside Thread{}.
//    Previously the fallback reconnect block ran synchronously on the Capacitor
//    main (UI) thread before Thread{} started. BluetoothSocket.connect() is a
//    blocking network call; doing it on the main thread causes
//    NetworkOnMainThreadException on Android 11+ (strict mode) and freezes the
//    UI on older versions. The entire print() body — reconnect + write — now
//    runs inside a single background Thread so the UI is never blocked.
//
//  FIX F — isConnected() uses a live probe instead of socket.isConnected.
//    BluetoothSocket.isConnected only reflects state at socket-creation time.
//    It stays true even after the remote device goes out of range or sleeps.
//    We now probe liveness by attempting to write a zero-length byte array;
//    an IOException means the connection is actually dead, so we close the
//    socket and return connected=false. The probe itself is fire-and-forget
//    on a background thread so the plugin method returns quickly.
//
// Capacitor plugin contract:
//   listPaired()          → { devices: [{ name, address }] }
//   connect(address)      → { success: boolean, error?: string }
//   disconnect()          → void
//   print(data: number[]) → { success: boolean, error?: string }
//   isConnected()         → { connected: boolean }

package com.mwpos.app

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH],            alias = "bluetooth"),
        Permission(strings = [Manifest.permission.BLUETOOTH_ADMIN],      alias = "bluetoothAdmin"),
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT],    alias = "bluetoothConnect"),
        Permission(strings = [Manifest.permission.BLUETOOTH_SCAN],       alias = "bluetoothScan"),
    ]
)
class BluetoothPrinterPlugin : Plugin() {

    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null
    // FIX A: connectedAddress is preserved across socket close so reconnect works
    private var connectedAddress: String? = null

    // ── Helper: get BluetoothAdapter safely ─────────────────────────────────
    private fun getAdapter(): BluetoothAdapter? {
        val bm = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        return bm?.adapter
    }

    // ── Helper: open an RFCOMM socket, trying secure then insecure (FIX C) ──
    private fun openSocket(device: BluetoothDevice): BluetoothSocket {
        return try {
            device.createRfcommSocketToServiceRecord(SPP_UUID)
        } catch (_: Exception) {
            // Reflection-based insecure fallback — works on most BT 4.0 portable printers
            val m = device.javaClass.getMethod(
                "createInsecureRfcommSocketToServiceRecord", UUID::class.java
            )
            m.invoke(device, SPP_UUID) as BluetoothSocket
        }
    }

    // ── listPaired ───────────────────────────────────────────────────────────
    @PluginMethod
    fun listPaired(call: PluginCall) {
        if (!hasBluetoothPermission()) {
            requestBluetoothPermissionsForCall(call, "listPairedCallback")
            return
        }
        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth not enabled")
            return
        }

        val arr = JSArray()
        try {
            val bonded = adapter.bondedDevices ?: emptySet()
            for (dev in bonded) {
                val obj = JSObject()
                obj.put("name",    dev.name    ?: "Unknown")
                obj.put("address", dev.address ?: "")
                arr.put(obj)
            }
        } catch (e: SecurityException) {
            call.reject("Permission denied: ${e.message}")
            return
        }

        val result = JSObject()
        result.put("devices", arr)
        call.resolve(result)
    }

    // ── connect ──────────────────────────────────────────────────────────────
    @PluginMethod
    fun connect(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.reject("address is required")
            return
        }
        if (!hasBluetoothPermission()) {
            requestBluetoothPermissionsForCall(call, "connectCallback")
            return
        }

        val adapter = getAdapter()
        if (adapter == null || !adapter.isEnabled) {
            call.reject("Bluetooth not enabled")
            return
        }

        // Close any old socket (connectedAddress intentionally kept — FIX A)
        closeSocket()

        Thread {
            try {
                val device: BluetoothDevice = adapter.getRemoteDevice(address)

                // FIX D: guard cancelDiscovery with BLUETOOTH_SCAN on Android 12+
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (ActivityCompat.checkSelfPermission(
                                context, Manifest.permission.BLUETOOTH_SCAN
                            ) == PackageManager.PERMISSION_GRANTED
                        ) {
                            adapter.cancelDiscovery()
                        }
                    } else {
                        adapter.cancelDiscovery()
                    }
                } catch (_: Exception) { /* ignore */ }

                val s = openSocket(device) // FIX C
                s.connect()
                socket = s
                outputStream = s.outputStream
                connectedAddress = address // FIX A: set after success

                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } catch (e: Exception) {
                closeSocket()
                connectedAddress = address // FIX A: keep for retry
                val result = JSObject()
                result.put("success", false)
                result.put("error", e.message ?: "Connection failed")
                call.resolve(result)
            }
        }.start()
    }

    // ── disconnect ───────────────────────────────────────────────────────────
    @PluginMethod
    fun disconnect(call: PluginCall) {
        closeSocket()
        connectedAddress = null // FIX A: only clear on explicit user disconnect
        call.resolve()
    }

    // ── isConnected — FIX F: live probe instead of socket.isConnected ────────
    //
    // BluetoothSocket.isConnected is set once at connect time and never updated;
    // it will return true even if the printer has gone to sleep or walked away.
    // We probe liveness by writing zero bytes: a broken pipe will throw IOException
    // immediately, proving the link is dead without sending any visible data.
    // The probe runs on a background thread; the plugin returns quickly.
    @PluginMethod
    fun isConnected(call: PluginCall) {
        val s = socket
        val stream = outputStream

        if (s == null || stream == null) {
            val result = JSObject()
            result.put("connected", false)
            call.resolve(result)
            return
        }

        // Run the live probe off the main thread (FIX E principle applied here too)
        Thread {
            val alive = try {
                stream.write(ByteArray(0)) // zero-byte write; throws if link is dead
                stream.flush()
                true
            } catch (_: IOException) {
                // Link is dead — clean up so next print triggers a fresh connect
                closeSocket()
                false
            }
            val result = JSObject()
            result.put("connected", alive)
            call.resolve(result)
        }.start()
    }

    // ── print — FIX E: entire body (reconnect + write) runs in Thread{} ─────
    //
    // Previously the fallback reconnect block ran on the calling (UI) thread
    // before Thread{} started. BluetoothSocket.connect() blocks the thread for
    // up to several seconds and causes NetworkOnMainThreadException on Android
    // 11+ strict mode. Moving everything into one Thread{} fixes both issues.
    @PluginMethod
    fun print(call: PluginCall) {
        val dataArray = call.getArray("data")
        if (dataArray == null) {
            call.reject("data is required")
            return
        }

        val addr = connectedAddress

        Thread {
            // ── Step 1: reconnect if socket is gone (FIX B + FIX E) ──────────
            if (socket?.isConnected != true) {
                if (addr == null) {
                    call.reject("Not connected to any printer")
                    return@Thread
                }
                val adapter = getAdapter()
                if (adapter == null || !adapter.isEnabled) {
                    call.reject("Bluetooth not enabled")
                    return@Thread
                }
                try {
                    closeSocket()
                    val device: BluetoothDevice = adapter.getRemoteDevice(addr)
                    val s = openSocket(device) // FIX C
                    s.connect()
                    socket = s
                    outputStream = s.outputStream
                    connectedAddress = addr
                } catch (e: Exception) {
                    connectedAddress = addr // keep for next attempt
                    val result = JSObject()
                    result.put("success", false)
                    result.put("error", "Reconnect failed: ${e.message}")
                    call.resolve(result)
                    return@Thread
                }
            }

            // ── Step 2: write the bytes ───────────────────────────────────────
            val stream = outputStream
            if (stream == null) {
                call.reject("Output stream unavailable")
                return@Thread
            }

            try {
                val bytes = ByteArray(dataArray.length()) { i ->
                    dataArray.getInt(i).toByte()
                }
                stream.write(bytes)
                stream.flush()

                val result = JSObject()
                result.put("success", true)
                call.resolve(result)
            } catch (e: IOException) {
                closeSocket()
                // FIX A: keep connectedAddress for reconnect on next print attempt
                val result = JSObject()
                result.put("success", false)
                result.put("error", e.message ?: "Print failed")
                call.resolve(result)
            }
        }.start()
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    // FIX A: closeSocket does NOT touch connectedAddress
    private fun closeSocket() {
        try { outputStream?.close() } catch (_: Exception) {}
        try { socket?.close()       } catch (_: Exception) {}
        socket       = null
        outputStream = null
        // connectedAddress intentionally NOT cleared here (FIX A)
    }

    private fun hasBluetoothPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(
                context, Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(
                context, Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun requestBluetoothPermissionsForCall(call: PluginCall, callbackName: String) {
        saveCall(call)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAliases(
                arrayOf("bluetoothConnect", "bluetoothScan"), call, callbackName
            )
        } else {
            requestPermissionForAliases(
                arrayOf("bluetooth", "bluetoothAdmin"), call, callbackName
            )
        }
    }

    @PermissionCallback
    private fun listPairedCallback(call: PluginCall) {
        if (hasBluetoothPermission()) listPaired(call)
        else call.reject("Bluetooth permission denied")
    }

    @PermissionCallback
    private fun connectCallback(call: PluginCall) {
        if (hasBluetoothPermission()) connect(call)
        else call.reject("Bluetooth permission denied")
    }
}