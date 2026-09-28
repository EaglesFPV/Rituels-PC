# Politique de sécurité

## Signaler une vulnérabilité

Merci de **ne pas ouvrir d'issue publique** pour une faille de sécurité. Utilisez le signalement privé
de GitHub : onglet **Security › Report a vulnerability** de ce dépôt.

Indiquez la version concernée, les étapes pour reproduire le problème et son impact. Une réponse est
apportée dans les meilleurs délais, et le correctif est publié dans une nouvelle version.

## Versions prises en charge

Seule la dernière version publiée reçoit des correctifs. Les mises à jour automatiques la diffusent
aux installations existantes.

## Modèle de menace

Rituels PC ouvre sur votre réseau local un petit serveur qui peut lancer des programmes, régler le volume
et éteindre le PC. La sécurité repose donc sur le fait que **seuls vos appareils appairés** peuvent lui parler.

### Ce contre quoi Rituels PC protège

- **Un inconnu sur le même Wi-Fi** : toute requête sans jeton valide est refusée. Un jeton s'obtient uniquement
  avec un code d'association affiché sur le PC (8 caractères, 5 minutes, usage unique). Les essais erronés
  sont bloqués de plus en plus longtemps.
- **Vol du fichier de configuration** : seul le hachage SHA-256 des jetons est stocké, jamais le jeton lui-même.
- **Un site web malveillant ouvert dans votre navigateur** : les cookies sont `SameSite=Strict` et `HttpOnly`,
  et toute écriture exige un en-tête personnalisé qu'un autre site ne peut pas envoyer. L'en-tête `Host` doit
  être une adresse locale, ce qui neutralise le « DNS rebinding ».
- **Injection dans l'interface** : politique de contenu `script-src 'self'`, sans script en ligne ; fenêtre
  Electron en bac à sable, sans intégration Node, permissions du navigateur refusées.
- **Injection de commandes par les champs d'un mode** : les identifiants de jeux, de produits, d'effets et de
  processus sont validés par liste blanche ; les chemins, arguments et cibles sont transmis aux scripts
  PowerShell par variables d'environnement, jamais concaténés dans une commande, et les liens sont ouverts
  sans interpréteur de commandes.
- **Appareil perdu** : chaque téléphone se retire depuis l'onglet Contrôle et son accès cesse aussitôt.
- **Reconnaissance vocale** : moteur local de Windows, rien n'est envoyé sur Internet, désactivée par défaut,
  et limitée à « verbe + nom d'un mode » (jamais l'alimentation).

### Ce contre quoi Rituels PC ne protège pas

- **Un appareil appairé compromis** : il peut tout ce que fait l'application, y compris exécuter une commande
  PowerShell via un mode. Retirez-le dès que vous le perdez.
- **Un programme malveillant déjà présent sur votre PC** : il peut lire la configuration et le jeton de la fenêtre.
- **Le trafic en clair sur le Wi-Fi** : la connexion est en HTTP sur le réseau local ; quelqu'un capable
  d'écouter votre réseau pourrait voir les échanges. Utilisez un réseau de confiance (pas de Wi-Fi public).
- **L'exposition sur Internet** : ne redirigez jamais le port 7799 depuis votre box.
- **Un installateur non signé** : vérifiez l'empreinte SHA-256 publiée avec chaque version.

## Bonnes pratiques

- Gardez le pare-feu Windows sur le profil **réseau privé** uniquement.
- Retirez les téléphones que vous n'utilisez plus.
- Ne collez dans un mode que des commandes PowerShell que vous comprenez.
