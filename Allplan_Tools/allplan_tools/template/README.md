# PythonPart direct : template

Installer la paire Plugin.pyp / Plugin.py avec les memes conventions que
les autres lanceurs du package de test. Le .py doit rester dans le package
qui contient entry.py et entry-config.json ; le .pyp va dans la bibliotheque.
Renommer les deux fichiers ensemble, adapter Script/Name dans le .pyp,
le libelle, puis PLUGIN_ID dans le .py avec un identifiant deja enregistre.
Ne pas ajouter de commande systeme ni de chemin d'executable dans le wrapper.

Conserver le bouton Launch / evenement 1001, sans champ InstallationType.
Le service partage impose Standard et collecte le contexte Allplan reel.
Le .pyp ne doit pas devenir un interactor.

create_script_object delegue au socle commun. La construction de l'objet,
la selection et l'apercu de bibliotheque ne lancent rien. Seul start_input
tente automatiquement le lancement, une fois par instance d'activation
et jamais pour is_only_update. execute et les changements de propriete
ne relancent rien. Le bouton Ouvrir utilise exactement la meme action,
permet une nouvelle tentative manuelle et ne ferme pas la palette.
Une demande deja en cours pour cette cible n'est pas doublee.
Fermer la palette n'arrete pas le processus du plugin.

Ne pas ajouter initialize_control_properties pour lancer : Allplan l'appelle
aussi lors de la generation de l'apercu de bibliotheque.

Pour les images, conserver Plugin_24.png (24 x 24), Plugin_128.png
(128 x 128) et Plugin.png strictement identique au _128. Adapter les noms
avec ceux du .pyp, sans modifier l'identite native du plugin.
