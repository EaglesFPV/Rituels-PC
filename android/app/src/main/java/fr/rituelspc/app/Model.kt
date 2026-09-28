package fr.rituelspc.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Un PC associé : son adresse locale, son nom et la MAC de sa carte Ethernet (pour l'allumer). */
data class Pc(val host: String, val port: Int, val name: String, val mac: String) {
    val base: String get() = "http://$host:$port"
}

data class Mode(val id: String, val name: String, val icon: String)

/** Stockage privé à l'application. Le jeton d'accès, lui, reste dans les cookies de la WebView. */
class Prefs(context: Context) {
    private val store = context.getSharedPreferences("rituels", Context.MODE_PRIVATE)

    var pc: Pc?
        get() = store.getString("host", null)?.let {
            Pc(it, store.getInt("port", 7799), store.getString("name", it) ?: it, store.getString("mac", "") ?: "")
        }
        set(value) {
            val editor = store.edit()
            if (value == null) {
                editor.clear()
            } else {
                editor.putString("host", value.host).putInt("port", value.port)
                    .putString("name", value.name).putString("mac", value.mac)
            }
            editor.apply()
        }

    /** Modes mémorisés à chaque connexion, pour pouvoir en choisir un quand le PC est éteint. */
    var modes: List<Mode>
        get() = runCatching {
            val array = JSONArray(store.getString("modes", "[]"))
            (0 until array.length()).map {
                val o = array.getJSONObject(it)
                Mode(o.getString("id"), o.getString("name"), o.optString("icon", "⚡"))
            }
        }.getOrDefault(emptyList())
        set(value) {
            val array = JSONArray(value.map { JSONObject().put("id", it.id).put("name", it.name).put("icon", it.icon) })
            store.edit().putString("modes", array.toString()).apply()
        }

    var wakeMode: String
        get() = store.getString("wakeMode", "") ?: ""
        set(value) = store.edit().putString("wakeMode", value).apply()
}

private val PRIVATE_IPV4 = Regex("""^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$""")

/** Refuse toute adresse hors réseau local : un QR code malveillant ne doit pas pointer vers Internet. */
fun isPrivateIPv4(host: String): Boolean = PRIVATE_IPV4.matches(host)
