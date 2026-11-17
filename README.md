# Filigrane

Ajoutez un filigrane à vos documents (pièce d'identité, bulletins de salaire, avis d'imposition…) **sans rien envoyer sur Internet**.

Équivalent local de [FiligraneFacile](https://filigrane.beta.gouv.fr/) (service de l'État, dont le code source est dans [Dossier-Facile-Frontend](https://github.com/MTES-MCT/Dossier-Facile-Frontend)) : là où le service officiel envoie vos fichiers sur ses serveurs, cette version fait tout le traitement dans votre navigateur. Projet indépendant, sans affiliation.

## Utilisation

Ouvrez `index.html` dans un navigateur récent, directement depuis le disque : aucun serveur web, aucune connexion réseau. Les bibliothèques nécessaires sont incluses dans `vendor/`.

1. Sélectionnez ou glissez vos fichiers : **jpg, png, heic, pdf** (et autres images lisibles par le navigateur). Vous pouvez les réordonner ou les retirer.
2. Saisissez le filigrane (100 caractères maximum, comme le service officiel). Des suggestions sont proposées et la date du jour peut être ajoutée automatiquement.
3. Cliquez sur **Ajouter le filigrane**, vérifiez l'aperçu, puis **Télécharger le document filigrané**.

Options avancées :

- un PDF distinct par fichier, ou un seul PDF regroupant tout (par défaut) ;
- couleurs variées ou filigrane gris uniforme ;
- ne pas recouvrir les QR codes (2D-Doc, etc.) pour qu'ils restent lisibles.

Les PDF protégés par mot de passe sont pris en charge : le mot de passe est demandé à l'ouverture.

## Fonctionnement

Chaque page (image ou page de PDF) est rastérisée, mise au format A4, filigranée puis enregistrée en JPEG dans un PDF A4. Le résultat est donc **aplati** : le filigrane ne peut pas être supprimé en éditant le PDF.

Le filigrane reproduit l'implémentation Java de FiligraneFacile (`BOPdfDocumentTemplate`) : texte répété sur dix lignes inclinées à -25°, superposé à une copie floutée, avec une opacité, un interligne et un rayon de flou tirés au hasard (le résultat diffère donc légèrement à chaque génération). Les tailles suivent les arrondis entiers du code Java, et le rayon du noyau gaussien Java est converti en écart-type pour le flou du navigateur. L'option couleur reprend les couleurs RGBA du code Java ; la distorsion n'est pas implémentée.

Différences restantes : le rendu des polices diffère entre le canvas du navigateur et Java AWT, et le lecteur Java détecte plus de formats de codes-barres (et plusieurs codes par page) que le lecteur QR inclus ici.

## Bibliothèques incluses (`vendor/`)

- [pdf.js](https://github.com/mozilla/pdf.js) 3.11.174 (`pdf.min.js` et `pdf.worker.min.js`), Apache-2.0 : lecture des PDF
- [jsPDF](https://github.com/parallax/jsPDF), MIT : création du PDF
- [jsQR](https://github.com/cozmo/jsQR), Apache-2.0 : détection des QR codes
- [heic2any](https://github.com/alexcorvi/heic2any) 0.0.4, MIT : conversion HEIC, chargé uniquement si le navigateur ne lit pas le HEIC nativement
