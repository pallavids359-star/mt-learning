package `in`.manchestertech.mt_student

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.UserManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Kiosk mode: once this app is the tablet's device owner (set once per tablet with adb, see
 * docs/TABLET_SETUP.md), the tablet runs only MT Learning. It opens on start-up as the home
 * screen, Home/Recents and the notification bar do nothing, and other apps cannot be opened.
 * Staff can unlock it from the app with the admin PIN; it locks again when the app restarts.
 * Without device owner nothing here changes how the tablet behaves.
 */
class MainActivity : FlutterActivity() {
    companion object {
        /** Unlocked by staff with the admin PIN. Not saved, so a restart locks the tablet again. */
        var maintenance = false
        private const val CHANNEL = "in.manchestertech/kiosk"
        private const val SETTINGS_APP = "com.android.settings"
        private val RESTRICTIONS = listOf(
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_ADD_USER,
        )
    }

    private val dpm by lazy { getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager }
    private val admin by lazy { ComponentName(this, AdminReceiver::class.java) }

    private fun isOwner() = dpm.isDeviceOwnerApp(packageName)

    private fun isLocked(): Boolean {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "status" -> result.success(mapOf("owner" to isOwner(), "locked" to isLocked(), "maintenance" to maintenance))
                    "lock" -> {
                        maintenance = false
                        result.success(lockKiosk())
                    }
                    "unlock" -> {
                        maintenance = true
                        if (isLocked()) stopLockTask()
                        if (isOwner()) dpm.setStatusBarDisabled(admin, false)
                        result.success(true)
                    }
                    "wifi" -> result.success(openScreen(Settings.ACTION_WIFI_SETTINGS))
                    "settings" -> result.success(openScreen(Settings.ACTION_SETTINGS))
                    "release" -> {
                        releaseKiosk()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("kiosk", e.message, null)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (!maintenance) {
            try {
                lockKiosk()
            } catch (e: Exception) {
            }
        }
    }

    /** Makes this app the only one that can run, and the home screen. Returns false if not device owner. */
    private fun lockKiosk(): Boolean {
        if (!isOwner()) return false
        // The Settings app is allowed only so staff can open Wi-Fi settings from the admin panel.
        dpm.setLockTaskPackages(admin, arrayOf(packageName, SETTINGS_APP))
        if (Build.VERSION.SDK_INT >= 28) {
            // Only the power menu stays; no Home, Recents, notifications or status bar.
            dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS)
        }
        val home = IntentFilter(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_HOME)
            addCategory(Intent.CATEGORY_DEFAULT)
        }
        dpm.addPersistentPreferredActivity(admin, home, ComponentName(this, MainActivity::class.java))
        dpm.setStatusBarDisabled(admin, true)
        for (r in RESTRICTIONS) dpm.addUserRestriction(admin, r)
        if (!isLocked()) startLockTask()
        return true
    }

    private fun openScreen(action: String): Boolean {
        startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }

    /** Removes kiosk mode for good (before the tablet is given away or reset). */
    private fun releaseKiosk() {
        maintenance = true
        if (isLocked()) stopLockTask()
        if (!isOwner()) return
        dpm.clearPackagePersistentPreferredActivities(admin, packageName)
        dpm.setStatusBarDisabled(admin, false)
        for (r in RESTRICTIONS) dpm.clearUserRestriction(admin, r)
        dpm.setLockTaskPackages(admin, arrayOf())
        @Suppress("DEPRECATION")
        dpm.clearDeviceOwnerApp(packageName)
    }
}
