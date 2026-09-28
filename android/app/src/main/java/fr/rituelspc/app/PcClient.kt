package fr.rituelspc.app

import android.webkit.CookieManager
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Appels natifs vers le service Rituels PC. À utiliser hors du thread principal. */
class PcClient(private val pc: Pc) {
    class Response(val code: Int, val body: String, val setCookies: List<String>)

    class Session(val authed: Boolean, val host: String)

    fun request(method: String, path: String, body: String? = null, timeoutMs: Int = 3000): Response {
        val connection = URL(pc.base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.setRequestProperty("x-pcr", "1")
            CookieManager.getInstance().getCookie(pc.base)?.let { connection.setRequestProperty("Cookie", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray()) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Response(code, text, connection.headerFields["Set-Cookie"] ?: emptyList())
        } finally {
            connection.disconnect()
        }
    }

    fun session(): Session {
        val json = JSONObject(request("GET", "/api/session").body)
        return Session(json.optBoolean("authed"), json.optString("host"))
    }

    /** Échange le code d'association contre un jeton (cookie). Renvoie un message d'erreur, ou null si tout va bien. */
    fun pair(code: String): String? {
        val response = request("POST", "/api/pair", JSONObject().put("code", code.trim()).toString())
        if (response.code == 200) {
            val cookies = CookieManager.getInstance()
            response.setCookies.forEach { cookies.setCookie(pc.base, it) }
            cookies.flush()
            return null
        }
        return runCatching { JSONObject(response.body).getString("error") }.getOrDefault("Erreur ${response.code}")
    }

    fun status(): JSONObject = JSONObject(request("GET", "/api/status").body)

    fun modes(): JSONArray = JSONArray(request("GET", "/api/modes").body)

    fun runMode(id: String): Response = request("POST", "/api/modes/$id/run")
}
