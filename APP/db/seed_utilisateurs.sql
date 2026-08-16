-- =====================================================================
--  JURIA — Jeu de données réel : utilisateurs (membres JFC AVOCATS MALI)
--  Généré depuis JFC_Liste_des_membres.xlsx (version validée par le cabinet).
--  Mise en service : remplacer 'A_DEFINIR' par un hash (bcrypt/argon2) distinct.
--  role_utilisateur : associe·collaborateur·stagiaire·assistante·comptable·admin
--  pole_cabinet     : conseil·contentieux  (NULL = transversal/support)
--  Mappage : Of Counsel/Avocat Associé->associe ; Avocat stagiaire & Stagiaire
--    ->stagiaire ; Juriste (y c. Principal)->collaborateur ; Archiviste->assistante ;
--    IT Manager->admin. « Conseil & Contentieux »->pole principal 'conseil'.
-- =====================================================================
INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, pole, taux_horaire, actif) VALUES
 ('MDA','Mohamed','DAOU','mda@jfcavocats-mali.com','A_DEFINIR','associe','conseil',310000,TRUE),
 ('HDA','Hâbou','DIAWARA','hda@jfcavocats-mali.com','A_DEFINIR','associe','conseil',280000,TRUE),
 ('BCO','Benkoro','COULIBALY','bco@jfcavocats-mali.com','A_DEFINIR','stagiaire','conseil',190000,TRUE),
 ('MKO','Mamadou I.','KONATE','mko@jfcavocats-mali.com','A_DEFINIR','associe','contentieux',310000,TRUE),
 ('MDJI','Mahamane','DJITEYE','mdji@jfcavocats-mali.com','A_DEFINIR','associe','contentieux',310000,TRUE),
 ('ODA','Ousmane','DAOU','oda@jfcavocats-mali.com','A_DEFINIR','collaborateur','contentieux',110000,TRUE),
 ('HNA','Houssinatou','NANGO','hna@jfcavocats-mali.com','A_DEFINIR','collaborateur','conseil',95000,TRUE),
 ('CDO','Christelle Pauline','DOBION','cdo@jfcavocats-mali.com','A_DEFINIR','collaborateur','conseil',95000,TRUE),
 ('FTO','Fatima','TOURE','fto@jfcavocats-mali.com','A_DEFINIR','collaborateur','conseil',95000,TRUE),
 ('DCO','Daouda','COULIBALY','dco@jfcavocats-mali.com','A_DEFINIR','collaborateur','contentieux',95000,TRUE),
 ('MND','Mariam','N''DIAYE','mnd@jfcavocats-mali.com','A_DEFINIR','stagiaire',NULL,50000,TRUE),
 ('ACO','Alassane','COULIBALY','aco@jfcavocats-mali.com','A_DEFINIR','comptable',NULL,0,TRUE),
 ('AND','Awa','N''DAW','and@jfcavocats-mali.com','A_DEFINIR','admin',NULL,0,TRUE),
 ('ACI','Aïssata','CISSE','aci@jfcavocats-mali.com','A_DEFINIR','assistante',NULL,0,TRUE),
 ('CDI','Cheick S.','DIARRA','cdi@jfcavocats-mali.com','A_DEFINIR','assistante',NULL,0,TRUE),
 ('MMA','Mamadou','MAKADJI','mma@jfcavocats-mali.com','A_DEFINIR','admin',NULL,0,TRUE)
ON CONFLICT (code) DO NOTHING;
