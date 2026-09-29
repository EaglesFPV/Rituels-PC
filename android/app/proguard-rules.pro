# Rituels PC ne réfléchit sur aucune classe : ni Gson/JSON par annotation (org.json est utilisé directement),
# ni interface JavaScript exposée à la WebView. Les règles ci-dessous ne font que couvrir les bibliothèques
# tierces (ZXing) dont certaines classes ne sont référencées que par leur nom.

-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }
-dontwarn com.google.zxing.**
