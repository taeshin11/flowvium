import json
import os

messages_dir = "C:/Flowvium/messages"

nav_keys = {
    "en.json": "Intelligence",
    "ko.json": "\uc778\ud154\ub9ac\uc804\uc2a4",
    "ja.json": "\u30a4\u30f3\u30c6\u30ea\u30b8\u30a7\u30f3\u30b9",
    "zh-CN.json": "\u667a\u80fd\u5206\u6790",
    "zh-TW.json": "\u667a\u80fd\u5206\u6790",
    "de.json": "Intelligenz",
    "es.json": "Inteligencia",
    "fr.json": "Intelligence",
    "pt.json": "Intelig\u00eancia",
    "ar.json": "\u0627\u0644\u0630\u0643\u0627\u0621",
    "hi.json": "\u0907\u0902\u091f\u0947\u0932\u093f\u091c\u0947\u0902\u0938",
    "id.json": "Intelijen",
    "ru.json": "\u0410\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0430",
    "th.json": "\u0e2d\u0e31\u0e08\u0e09\u0e23\u0e34\u0e22\u0e30",
    "tr.json": "\u0130stihbarat",
    "vi.json": "Th\u00f4ng tin",
}

intelligence_ns = {
    "en.json": {
        "title": "Macro Intelligence",
        "subtitle": "The structural forces driving smart money",
        "description": "Understand the hidden mechanisms of power, money, and information that shape markets before they become headlines.",
        "askQuestion": "Ask Flowvium AI...",
        "askPlaceholder": "e.g. Why is Wall Street so profitable? Who benefits from QE?",
        "analyzing": "Analyzing...",
        "analyze": "Ask",
        "relatedThemes": "Related Macro Themes",
        "readDeepDive": "Read Deep Dive",
        "learnMore": "Learn More",
        "keyConceptsLabel": "Key Concepts",
        "categoryPower": "Power Structure",
        "categoryMonetary": "Monetary",
        "categoryGeopolitical": "Geopolitical",
        "categoryInformation": "Information",
        "categoryRegulatory": "Regulatory"
    },
    "ko.json": {
        "title": "\ub9e4\ud06c\ub85c \uc778\ud154\ub9ac\uc804\uc2a4",
        "subtitle": "\uc2a4\ub9c8\ud2b8 \uba38\ub2c8\ub97c \uc6c0\uc9c1\uc774\ub294 \uad6c\uc870\uc801 \ud798",
        "description": "\uc2dc\uc7a5\uc744 \ud615\uc131\ud558\ub294 \uad8c\ub825, \ub3c8, \uc815\ubcf4\uc758 \uc228\uacaca \uba54\ucee4\ub2c8\uc998\uc744 \ub274\uc2a4\uac00 \ub418\uae30 \uc804\uc5d0 \uc774\ud574\ud558\uc138\uc694.",
        "askQuestion": "Flowvium AI\uc5d0 \uc9c8\ubb38\ud558\uae30...",
        "askPlaceholder": "\uc608: \uc65c \uc6d4\uac00\ub294 \ud56d\uc0c1 \ub3c8\uc744 \ubc84\ub098? QE\ub85c \ub204\uac00 \uc774\ub4dd\uc744 \ubcf4\ub098?",
        "analyzing": "\ubd84\uc11d \uc911...",
        "analyze": "\uc9c8\ubb38\ud558\uae30",
        "relatedThemes": "\uad00\ub828 \ub9e4\ud06c\ub85c \ud14c\ub9c8",
        "readDeepDive": "\uc2ec\uce35 \ubd84\uc11d \uc77d\uae30",
        "learnMore": "\ub354 \uc54c\uc544\ubcf4\uae30",
        "keyConceptsLabel": "\ud575\uc2ec \uac1c\ub150",
        "categoryPower": "\uad8c\ub825 \uad6c\uc870",
        "categoryMonetary": "\ud1b5\ud654/\uae08\uc735",
        "categoryGeopolitical": "\uc9c0\uc815\ud559",
        "categoryInformation": "\uc815\ubcf4 \ube44\ub300\uce59",
        "categoryRegulatory": "\uaddc\uc81c"
    },
    "ja.json": {
        "title": "\u30de\u30af\u30ed\u30a4\u30f3\u30c6\u30ea\u30b8\u30a7\u30f3\u30b9",
        "subtitle": "\u30b9\u30de\u30fc\u30c8\u30de\u30cd\u30fc\u3092\u52d5\u304b\u3059\u69cb\u9020\u7684\u306a\u529b",
        "description": "\u5e02\u5834\u3092\u5f62\u6210\u3059\u308b\u6a29\u529b\u30fb\u8cc7\u91d1\u30fb\u60c5\u5831\u306e\u9690\u308c\u305f\u30e1\u30ab\u30cb\u30ba\u30e0\u3092\u30cb\u30e5\u30fc\u30b9\u306b\u306a\u308b\u524d\u306b\u7406\u89e3\u3059\u308b\u3002",
        "askQuestion": "Flowvium AI\u306b\u8cea\u554f...",
        "askPlaceholder": "\u4f8b\uff1a\u306a\u305c\u30a6\u30a9\u30fc\u30eb\u8857\u306f\u5e38\u306b\u5229\u76ca\u3092\u4e0a\u3052\u308b\u306e\u304b\uff1f",
        "analyzing": "\u5206\u6790\u4e2d...",
        "analyze": "\u8cea\u554f\u3059\u308b",
        "relatedThemes": "\u95a2\u9023\u30de\u30af\u30ed\u30c6\u30fc\u30de",
        "readDeepDive": "\u8a73\u7d30\u5206\u6790\u3092\u8aad\u3080",
        "learnMore": "\u8a73\u7d30",
        "keyConceptsLabel": "\u91cd\u8981\u6982\u5ff5",
        "categoryPower": "\u6a29\u529b\u69cb\u9020",
        "categoryMonetary": "\u91d1\u878d\u653f\u7b56",
        "categoryGeopolitical": "\u5730\u653f\u5b66",
        "categoryInformation": "\u60c5\u5831\u306e\u975e\u5bfe\u79f0\u6027",
        "categoryRegulatory": "\u898f\u5236"
    },
    "zh-CN.json": {
        "title": "\u5b8f\u89c2\u60c5\u62a5",
        "subtitle": "\u9a71\u52a8\u806a\u660e\u8d44\u91d1\u7684\u7ed3\u6784\u6027\u529b\u91cf",
        "description": "\u5728\u65b0\u95fb\u51fa\u73b0\u4e4b\u524d\uff0c\u4e86\u89e3\u5851\u9020\u5e02\u573a\u7684\u6743\u529b\u3001\u8d44\u91d1\u548c\u4fe1\u606f\u7684\u9690\u85cf\u673a\u5236\u3002",
        "askQuestion": "\u5411Flowvium AI\u63d0\u95ee...",
        "askPlaceholder": "\u4f8b\u5982\uff1a\u4e3a\u4ec0\u4e48\u534e\u5c14\u8857\u603b\u662f\u76c8\u5229\uff1f\u8c01\u4ece\u91cf\u5316\u5bbd\u677e\u4e2d\u83b7\u76ca\uff1f",
        "analyzing": "\u5206\u6790\u4e2d...",
        "analyze": "\u63d0\u95ee",
        "relatedThemes": "\u76f8\u5173\u5b8f\u89c2\u4e3b\u9898",
        "readDeepDive": "\u9605\u8bfb\u6df1\u5ea6\u5206\u6790",
        "learnMore": "\u4e86\u89e3\u66f4\u591a",
        "keyConceptsLabel": "\u6838\u5fc3\u6982\u5ff5",
        "categoryPower": "\u6743\u529b\u7ed3\u6784",
        "categoryMonetary": "\u8d27\u5e01\u653f\u7b56",
        "categoryGeopolitical": "\u5730\u7f18\u653f\u6cbb",
        "categoryInformation": "\u4fe1\u606f\u4e0d\u5bf9\u79f0",
        "categoryRegulatory": "\u76d1\u7ba1"
    },
    "zh-TW.json": {
        "title": "\u5b8f\u89c0\u60c5\u5831",
        "subtitle": "\u9a45\u52d5\u806a\u660e\u8cc7\u91d1\u7684\u7d50\u69cb\u6027\u529b\u91cf",
        "description": "\u5728\u65b0\u805e\u51fa\u73fe\u4e4b\u524d\uff0c\u4e86\u89e3\u5851\u9020\u5e02\u5834\u7684\u6b0a\u529b\u3001\u8cc7\u91d1\u548c\u4fe1\u606f\u7684\u96b1\u85cf\u6a5f\u5236\u3002",
        "askQuestion": "\u5411Flowvium AI\u63d0\u554f...",
        "askPlaceholder": "\u4f8b\u5982\uff1a\u70ba\u4ec0\u9ebc\u83ef\u723e\u8857\u7e3d\u662f\u7372\u5229\uff1f\u8ab0\u5f9e\u91cf\u5316\u5bec\u9b06\u4e2d\u7372\u76ca\uff1f",
        "analyzing": "\u5206\u6790\u4e2d...",
        "analyze": "\u63d0\u554f",
        "relatedThemes": "\u76f8\u95dc\u5b8f\u89c0\u4e3b\u984c",
        "readDeepDive": "\u95b1\u8b80\u6df1\u5ea6\u5206\u6790",
        "learnMore": "\u4e86\u89e3\u66f4\u591a",
        "keyConceptsLabel": "\u6838\u5fc3\u6982\u5ff5",
        "categoryPower": "\u6b0a\u529b\u7d50\u69cb",
        "categoryMonetary": "\u8ca8\u5e63\u653f\u7b56",
        "categoryGeopolitical": "\u5730\u7de3\u653f\u6cbb",
        "categoryInformation": "\u4fe1\u606f\u4e0d\u5c0d\u7a31",
        "categoryRegulatory": "\u76e3\u7ba1"
    },
    "de.json": {
        "title": "Makro-Intelligenz",
        "subtitle": "Die strukturellen Kr\u00e4fte, die Smart Money antreiben",
        "description": "Verstehen Sie die verborgenen Mechanismen von Macht, Geld und Information, die M\u00e4rkte pr\u00e4gen.",
        "askQuestion": "Flowvium AI fragen...",
        "askPlaceholder": "z.B. Warum ist die Wall Street so profitabel?",
        "analyzing": "Analysiere...",
        "analyze": "Fragen",
        "relatedThemes": "Verwandte Makro-Themen",
        "readDeepDive": "Tiefenanalyse lesen",
        "learnMore": "Mehr erfahren",
        "keyConceptsLabel": "Schl\u00fcsselkonzepte",
        "categoryPower": "Machtstruktur",
        "categoryMonetary": "Geldpolitik",
        "categoryGeopolitical": "Geopolitik",
        "categoryInformation": "Informationsasymmetrie",
        "categoryRegulatory": "Regulierung"
    },
    "es.json": {
        "title": "Inteligencia Macro",
        "subtitle": "Las fuerzas estructurales que mueven el dinero inteligente",
        "description": "Entienda los mecanismos ocultos del poder, el dinero y la informaci\u00f3n que dan forma a los mercados.",
        "askQuestion": "Pregunta a Flowvium AI...",
        "askPlaceholder": "ej. \u00bfPor qu\u00e9 Wall Street siempre gana?",
        "analyzing": "Analizando...",
        "analyze": "Preguntar",
        "relatedThemes": "Temas Macro Relacionados",
        "readDeepDive": "Leer An\u00e1lisis Profundo",
        "learnMore": "Saber m\u00e1s",
        "keyConceptsLabel": "Conceptos Clave",
        "categoryPower": "Estructura de Poder",
        "categoryMonetary": "Monetario",
        "categoryGeopolitical": "Geopol\u00edtico",
        "categoryInformation": "Asimetr\u00eda de Informaci\u00f3n",
        "categoryRegulatory": "Regulatorio"
    },
    "fr.json": {
        "title": "Intelligence Macro",
        "subtitle": "Les forces structurelles qui animent l'argent intelligent",
        "description": "Comprenez les m\u00e9canismes cach\u00e9s du pouvoir, de l'argent et de l'information qui fa\u00e7onnent les march\u00e9s.",
        "askQuestion": "Demandez \u00e0 Flowvium AI...",
        "askPlaceholder": "ex. Pourquoi Wall Street est-il si rentable ?",
        "analyzing": "Analyse en cours...",
        "analyze": "Demander",
        "relatedThemes": "Th\u00e8mes Macro Connexes",
        "readDeepDive": "Lire l'Analyse Approfondie",
        "learnMore": "En savoir plus",
        "keyConceptsLabel": "Concepts Cl\u00e9s",
        "categoryPower": "Structure du Pouvoir",
        "categoryMonetary": "Mon\u00e9taire",
        "categoryGeopolitical": "G\u00e9opolitique",
        "categoryInformation": "Asym\u00e9trie d'Information",
        "categoryRegulatory": "R\u00e9glementaire"
    },
    "pt.json": {
        "title": "Intelig\u00eancia Macro",
        "subtitle": "As for\u00e7as estruturais que movem o dinheiro inteligente",
        "description": "Entenda os mecanismos ocultos de poder, dinheiro e informa\u00e7\u00e3o que moldam os mercados.",
        "askQuestion": "Pergunte ao Flowvium AI...",
        "askPlaceholder": "ex. Por que Wall Street \u00e9 t\u00e3o lucrativa?",
        "analyzing": "Analisando...",
        "analyze": "Perguntar",
        "relatedThemes": "Temas Macro Relacionados",
        "readDeepDive": "Ler An\u00e1lise Profunda",
        "learnMore": "Saber mais",
        "keyConceptsLabel": "Conceitos-chave",
        "categoryPower": "Estrutura de Poder",
        "categoryMonetary": "Monet\u00e1rio",
        "categoryGeopolitical": "Geopol\u00edtico",
        "categoryInformation": "Assimetria de Informa\u00e7\u00e3o",
        "categoryRegulatory": "Regulat\u00f3rio"
    },
    "ar.json": {
        "title": "\u0630\u0643\u0627\u0621 \u0627\u0644\u0627\u0642\u062a\u0635\u0627\u062f \u0627\u0644\u0643\u0644\u064a",
        "subtitle": "\u0627\u0644\u0642\u0648\u0649 \u0627\u0644\u0647\u064a\u0643\u0644\u064a\u0629 \u0627\u0644\u062a\u064a \u062a\u062d\u0631\u0643 \u0627\u0644\u0623\u0645\u0648\u0627\u0644 \u0627\u0644\u0630\u0643\u064a\u0629",
        "description": "\u0627\u0641\u0647\u0645 \u0627\u0644\u0622\u0644\u064a\u0627\u062a \u0627\u0644\u062e\u0641\u064a\u0629 \u0644\u0644\u0633\u0644\u0637\u0629 \u0648\u0627\u0644\u0645\u0627\u0644 \u0648\u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a \u0627\u0644\u062a\u064a \u062a\u0634\u0643\u0644 \u0627\u0644\u0623\u0633\u0648\u0627\u0642.",
        "askQuestion": "\u0627\u0633\u0623\u0644 Flowvium AI...",
        "askPlaceholder": "\u0645\u062b\u0627\u0644: \u0644\u0645\u0627\u0630\u0627 \u0648\u0648\u0644 \u0633\u062a\u0631\u064a\u062a \u0645\u0631\u0628\u062d \u062f\u0627\u0626\u0645\u0627\u061f",
        "analyzing": "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0644\u064a\u0644...",
        "analyze": "\u0627\u0633\u0623\u0644",
        "relatedThemes": "\u0627\u0644\u0645\u0648\u0627\u0636\u064a\u0639 \u0627\u0644\u0643\u0644\u064a\u0629 \u0630\u0627\u062a \u0627\u0644\u0635\u0644\u0629",
        "readDeepDive": "\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0645\u0639\u0645\u0642",
        "learnMore": "\u0627\u0639\u0631\u0641 \u0623\u0643\u062b\u0631",
        "keyConceptsLabel": "\u0627\u0644\u0645\u0641\u0627\u0647\u064a\u0645 \u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629",
        "categoryPower": "\u0647\u064a\u0643\u0644 \u0627\u0644\u0633\u0644\u0637\u0629",
        "categoryMonetary": "\u0627\u0644\u0646\u0642\u062f\u064a",
        "categoryGeopolitical": "\u0627\u0644\u062c\u064a\u0648\u0633\u064a\u0627\u0633\u064a",
        "categoryInformation": "\u0639\u062f\u0645 \u062a\u0645\u0627\u062b\u0644 \u0627\u0644\u0645\u0639\u0644\u0648\u0645\u0627\u062a",
        "categoryRegulatory": "\u0627\u0644\u062a\u0646\u0638\u064a\u0645\u064a"
    },
    "hi.json": {
        "title": "\u092e\u0948\u0915\u094d\u0930\u094b \u0907\u0902\u091f\u0947\u0932\u093f\u091c\u0947\u0902\u0938",
        "subtitle": "\u0938\u094d\u092e\u093e\u0930\u094d\u091f \u092e\u0928\u0940 \u0915\u094b \u091a\u0932\u093e\u0928\u0947 \u0935\u093e\u0932\u0940 \u0938\u0902\u0930\u091a\u0928\u093e\u0924\u094d\u092e\u0915 \u0936\u0915\u094d\u0924\u093f\u092f\u093e\u0902",
        "description": "\u092c\u093e\u091c\u093e\u0930\u094b\u0902 \u0915\u094b \u0906\u0915\u093e\u0930 \u0926\u0947\u0928\u0947 \u0935\u093e\u0932\u0940 \u0936\u0915\u094d\u0924\u093f, \u0927\u0928 \u0914\u0930 \u0938\u0942\u091a\u0928\u093e \u0915\u0947 \u091b\u093f\u092a\u0947 \u0924\u0902\u0924\u094d\u0930 \u0915\u094b \u0938\u092e\u091d\u0947\u0902\u0964",
        "askQuestion": "Flowvium AI \u0938\u0947 \u092a\u0942\u091b\u0947\u0902...",
        "askPlaceholder": "\u0909\u0926\u093e. \u0935\u0949\u0932 \u0938\u094d\u091f\u094d\u0930\u0940\u091f \u0907\u0924\u0928\u093e \u0932\u093e\u092d\u0926\u093e\u092f\u0915 \u0915\u094d\u092f\u094b\u0902 \u0939\u0948?",
        "analyzing": "\u0935\u093f\u0936\u094d\u0932\u0947\u0937\u0923 \u0939\u094b \u0930\u0939\u093e \u0939\u0948...",
        "analyze": "\u092a\u0942\u091b\u0947\u0902",
        "relatedThemes": "\u0938\u0902\u092c\u0902\u0927\u093f\u0924 \u092e\u0948\u0915\u094d\u0930\u094b \u0925\u0940\u092e",
        "readDeepDive": "\u0917\u0939\u0928 \u0935\u093f\u0936\u094d\u0932\u0947\u0937\u0923 \u092a\u0922\u093c\u0947\u0902",
        "learnMore": "\u0905\u0927\u093f\u0915 \u091c\u093e\u0928\u0947\u0902",
        "keyConceptsLabel": "\u092e\u0941\u0916\u094d\u092f \u0905\u0935\u0927\u093e\u0930\u0923\u093e\u090f\u0902",
        "categoryPower": "\u0936\u0915\u094d\u0924\u093f \u0938\u0902\u0930\u091a\u0928\u093e",
        "categoryMonetary": "\u092e\u094c\u0926\u094d\u0930\u093f\u0915",
        "categoryGeopolitical": "\u092d\u0942-\u0930\u093e\u091c\u0928\u0940\u0924\u093f\u0915",
        "categoryInformation": "\u0938\u0942\u091a\u0928\u093e \u0905\u0938\u092e\u093e\u0928\u0924\u093e",
        "categoryRegulatory": "\u0928\u093f\u092f\u093e\u092e\u0915"
    },
    "id.json": {
        "title": "Intelijen Makro",
        "subtitle": "Kekuatan struktural yang menggerakkan uang cerdas",
        "description": "Pahami mekanisme tersembunyi dari kekuatan, uang, dan informasi yang membentuk pasar.",
        "askQuestion": "Tanya Flowvium AI...",
        "askPlaceholder": "mis. Mengapa Wall Street begitu menguntungkan?",
        "analyzing": "Menganalisis...",
        "analyze": "Tanya",
        "relatedThemes": "Tema Makro Terkait",
        "readDeepDive": "Baca Analisis Mendalam",
        "learnMore": "Pelajari lebih lanjut",
        "keyConceptsLabel": "Konsep Kunci",
        "categoryPower": "Struktur Kekuatan",
        "categoryMonetary": "Moneter",
        "categoryGeopolitical": "Geopolitik",
        "categoryInformation": "Asimetri Informasi",
        "categoryRegulatory": "Regulatori"
    },
    "ru.json": {
        "title": "\u041c\u0430\u043a\u0440\u043e-\u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0430",
        "subtitle": "\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u043d\u044b\u0435 \u0441\u0438\u043b\u044b, \u0434\u0432\u0438\u0436\u0443\u0449\u0438\u0435 \u0443\u043c\u043d\u044b\u043c\u0438 \u0434\u0435\u043d\u044c\u0433\u0430\u043c\u0438",
        "description": "\u041f\u043e\u0439\u043c\u0438\u0442\u0435 \u0441\u043a\u0440\u044b\u0442\u044b\u0435 \u043c\u0435\u0445\u0430\u043d\u0438\u0437\u043c\u044b \u0432\u043b\u0430\u0441\u0442\u0438, \u0434\u0435\u043d\u0435\u0433 \u0438 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u0438, \u043a\u043e\u0442\u043e\u0440\u044b\u0435 \u0444\u043e\u0440\u043c\u0438\u0440\u0443\u044e\u0442 \u0440\u044b\u043d\u043a\u0438.",
        "askQuestion": "\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u0435 Flowvium AI...",
        "askPlaceholder": "\u043d\u0430\u043f\u0440. \u041f\u043e\u0447\u0435\u043c\u0443 \u0423\u043e\u043b\u043b-\u0441\u0442\u0440\u0438\u0442 \u0442\u0430\u043a \u043f\u0440\u0438\u0431\u044b\u043b\u044c\u043d\u0430?",
        "analyzing": "\u0410\u043d\u0430\u043b\u0438\u0437\u0438\u0440\u0443\u044e...",
        "analyze": "\u0421\u043f\u0440\u043e\u0441\u0438\u0442\u044c",
        "relatedThemes": "\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u043c\u0430\u043a\u0440\u043e-\u0442\u0435\u043c\u044b",
        "readDeepDive": "\u0427\u0438\u0442\u0430\u0442\u044c \u0433\u043b\u0443\u0431\u043e\u043a\u0438\u0439 \u0430\u043d\u0430\u043b\u0438\u0437",
        "learnMore": "\u0423\u0437\u043d\u0430\u0442\u044c \u0431\u043e\u043b\u044c\u0448\u0435",
        "keyConceptsLabel": "\u041a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u043f\u043e\u043d\u044f\u0442\u0438\u044f",
        "categoryPower": "\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0432\u043b\u0430\u0441\u0442\u0438",
        "categoryMonetary": "\u041c\u043e\u043d\u0435\u0442\u0430\u0440\u043d\u0430\u044f",
        "categoryGeopolitical": "\u0413\u0435\u043e\u043f\u043e\u043b\u0438\u0442\u0438\u043a\u0430",
        "categoryInformation": "\u0418\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u043e\u043d\u043d\u0430\u044f \u0430\u0441\u0438\u043c\u043c\u0435\u0442\u0440\u0438\u044f",
        "categoryRegulatory": "\u0420\u0435\u0433\u0443\u043b\u044f\u0442\u043e\u0440\u043d\u0430\u044f"
    },
    "th.json": {
        "title": "\u0e23\u0e30\u0e1a\u0e1a\u0e02\u0e48\u0e32\u0e27\u0e01\u0e23\u0e2d\u0e07\u0e21\u0e2b\u0e20\u0e32\u0e04",
        "subtitle": "\u0e41\u0e23\u0e07\u0e1c\u0e25\u0e31\u0e01\u0e14\u0e31\u0e19\u0e40\u0e0a\u0e34\u0e07\u0e42\u0e04\u0e23\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e17\u0e35\u0e48\u0e02\u0e31\u0e1a\u0e40\u0e04\u0e25\u0e37\u0e48\u0e2d\u0e19\u0e40\u0e07\u0e34\u0e19\u0e2d\u0e31\u0e08\u0e09\u0e23\u0e34\u0e22\u0e30",
        "description": "\u0e17\u0e33\u0e04\u0e27\u0e32\u0e21\u0e40\u0e02\u0e49\u0e32\u0e43\u0e08\u0e01\u0e25\u0e44\u0e01\u0e17\u0e35\u0e48\u0e0b\u0e48\u0e2d\u0e19\u0e2d\u0e22\u0e39\u0e48\u0e02\u0e2d\u0e07\u0e2d\u0e33\u0e19\u0e32\u0e08 \u0e40\u0e07\u0e34\u0e19 \u0e41\u0e25\u0e30\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e17\u0e35\u0e48\u0e01\u0e33\u0e2b\u0e19\u0e14\u0e15\u0e25\u0e32\u0e14",
        "askQuestion": "\u0e16\u0e32\u0e21 Flowvium AI...",
        "askPlaceholder": "\u0e40\u0e0a\u0e48\u0e19 \u0e17\u0e33\u0e44\u0e21 Wall Street \u0e16\u0e36\u0e07\u0e17\u0e33\u0e01\u0e33\u0e44\u0e23\u0e44\u0e14\u0e49\u0e40\u0e2a\u0e21\u0e2d?",
        "analyzing": "\u0e01\u0e33\u0e25\u0e31\u0e07\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c...",
        "analyze": "\u0e16\u0e32\u0e21",
        "relatedThemes": "\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d\u0e21\u0e2b\u0e20\u0e32\u0e04\u0e17\u0e35\u0e48\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27\u0e02\u0e49\u0e2d\u0e07",
        "readDeepDive": "\u0e2d\u0e48\u0e32\u0e19\u0e01\u0e32\u0e23\u0e27\u0e34\u0e40\u0e04\u0e23\u0e32\u0e30\u0e2b\u0e4c\u0e40\u0e0a\u0e34\u0e07\u0e25\u0e36\u0e01",
        "learnMore": "\u0e40\u0e23\u0e35\u0e22\u0e19\u0e23\u0e39\u0e49\u0e40\u0e1e\u0e34\u0e48\u0e21\u0e40\u0e15\u0e34\u0e21",
        "keyConceptsLabel": "\u0e41\u0e19\u0e27\u0e04\u0e34\u0e14\u0e2b\u0e25\u0e31\u0e01",
        "categoryPower": "\u0e42\u0e04\u0e23\u0e07\u0e2a\u0e23\u0e49\u0e32\u0e07\u0e2d\u0e33\u0e19\u0e32\u0e08",
        "categoryMonetary": "\u0e01\u0e32\u0e23\u0e40\u0e07\u0e34\u0e19",
        "categoryGeopolitical": "\u0e20\u0e39\u0e21\u0e34\u0e23\u0e31\u0e10\u0e28\u0e32\u0e2a\u0e15\u0e23\u0e4c",
        "categoryInformation": "\u0e04\u0e27\u0e32\u0e21\u0e44\u0e21\u0e48\u0e2a\u0e21\u0e14\u0e38\u0e25\u0e02\u0e2d\u0e07\u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25",
        "categoryRegulatory": "\u0e01\u0e0e\u0e23\u0e30\u0e40\u0e1a\u0e35\u0e22\u0e1a"
    },
    "tr.json": {
        "title": "Makro \u0130stihbarat",
        "subtitle": "Ak\u0131ll\u0131 paray\u0131 y\u00f6nlendiren yap\u0131sal g\u00fc\u00e7ler",
        "description": "Piyasalar\u0131 \u015fekillendiren g\u00fc\u00e7, para ve bilginin gizli mekanizmalar\u0131n\u0131 anlay\u0131n.",
        "askQuestion": "Flowvium AI'ya sor...",
        "askPlaceholder": "\u00f6r. Neden Wall Street bu kadar karl\u0131?",
        "analyzing": "Analiz ediliyor...",
        "analyze": "Sor",
        "relatedThemes": "\u0130lgili Makro Temalar",
        "readDeepDive": "Derin Analizi Oku",
        "learnMore": "Daha fazla \u00f6\u011fren",
        "keyConceptsLabel": "Temel Kavramlar",
        "categoryPower": "G\u00fc\u00e7 Yap\u0131s\u0131",
        "categoryMonetary": "Parasal",
        "categoryGeopolitical": "Jeopolitik",
        "categoryInformation": "Bilgi Asimetrisi",
        "categoryRegulatory": "D\u00fczenleyici"
    },
    "vi.json": {
        "title": "Th\u00f4ng tin Kinh t\u1ebf V\u0129 m\u00f4",
        "subtitle": "C\u00e1c l\u1ef1c l\u01b0\u1ee3ng c\u1ea5u tr\u00fac th\u00fac \u0111\u1ea9y d\u00f2ng ti\u1ec1n th\u00f4ng minh",
        "description": "Hi\u1ec3u c\u00e1c c\u01a1 ch\u1ebf \u1ea9n c\u1ee7a quy\u1ec1n l\u1ef1c, ti\u1ec1n b\u1ea1c v\u00e0 th\u00f4ng tin \u0111\u1ecbnh h\u00ecnh th\u1ecb tr\u01b0\u1eddng.",
        "askQuestion": "H\u1ecfi Flowvium AI...",
        "askPlaceholder": "vd. T\u1ea1i sao Wall Street lu\u00f4n c\u00f3 l\u00e3i?",
        "analyzing": "\u0110ang ph\u00e2n t\u00edch...",
        "analyze": "H\u1ecfi",
        "relatedThemes": "Ch\u1ee7 \u0111\u1ec1 V\u0129 m\u00f4 Li\u00ean quan",
        "readDeepDive": "\u0110\u1ecdc Ph\u00e2n t\u00edch Chuy\u00ean s\u00e2u",
        "learnMore": "T\u00ecm hi\u1ec3u th\u00eam",
        "keyConceptsLabel": "Kh\u00e1i ni\u1ec7m Ch\u00ednh",
        "categoryPower": "C\u1ea5u tr\u00fac Quy\u1ec1n l\u1ef1c",
        "categoryMonetary": "Ti\u1ec1n t\u1ec7",
        "categoryGeopolitical": "\u0110\u1ecba ch\u00ednh tr\u1ecb",
        "categoryInformation": "B\u1ea5t c\u00e2n x\u1ee9ng Th\u00f4ng tin",
        "categoryRegulatory": "Quy \u0111\u1ecbnh"
    }
}

company_additions = {
    "en.json": {"relatedMacroThemes": "Related Macro Themes", "viewAllThemes": "View All Themes"},
    "ko.json": {"relatedMacroThemes": "\uc5f0\uad00 \ub9e4\ud06c\ub85c \ud14c\ub9c8", "viewAllThemes": "\ubaa8\ub4e0 \ud14c\ub9c8 \ubcf4\uae30"},
    "ja.json": {"relatedMacroThemes": "\u95a2\u9023\u30de\u30af\u30ed\u30c6\u30fc\u30de", "viewAllThemes": "\u5168\u30c6\u30fc\u30de\u3092\u898b\u308b"},
    "zh-CN.json": {"relatedMacroThemes": "\u76f8\u5173\u5b8f\u89c2\u4e3b\u9898", "viewAllThemes": "\u67e5\u770b\u6240\u6709\u4e3b\u9898"},
    "zh-TW.json": {"relatedMacroThemes": "\u76f8\u95dc\u5b8f\u89c0\u4e3b\u9898", "viewAllThemes": "\u67e5\u770b\u6240\u6709\u4e3b\u9898"},
    "de.json": {"relatedMacroThemes": "Verwandte Makro-Themen", "viewAllThemes": "Alle Themen"},
    "es.json": {"relatedMacroThemes": "Temas Macro Relacionados", "viewAllThemes": "Ver Todos los Temas"},
    "fr.json": {"relatedMacroThemes": "Th\u00e8mes Macro Connexes", "viewAllThemes": "Voir Tous les Th\u00e8mes"},
    "pt.json": {"relatedMacroThemes": "Temas Macro Relacionados", "viewAllThemes": "Ver Todos os Temas"},
    "ar.json": {"relatedMacroThemes": "\u0627\u0644\u0645\u0648\u0627\u0636\u064a\u0639 \u0627\u0644\u0643\u0644\u064a\u0629 \u0630\u0627\u062a \u0627\u0644\u0635\u0644\u0629", "viewAllThemes": "\u0639\u0631\u0636 \u062c\u0645\u064a\u0639 \u0627\u0644\u0645\u0648\u0627\u0636\u064a\u0639"},
    "hi.json": {"relatedMacroThemes": "\u0938\u0902\u092c\u0902\u0927\u093f\u0924 \u092e\u0948\u0915\u094d\u0930\u094b \u0925\u0940\u092e", "viewAllThemes": "\u0938\u092d\u0940 \u0925\u0940\u092e \u0926\u0947\u0916\u0947\u0902"},
    "id.json": {"relatedMacroThemes": "Tema Makro Terkait", "viewAllThemes": "Lihat Semua Tema"},
    "ru.json": {"relatedMacroThemes": "\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u043c\u0430\u043a\u0440\u043e-\u0442\u0435\u043c\u044b", "viewAllThemes": "\u0412\u0441\u0435 \u0442\u0435\u043c\u044b"},
    "th.json": {"relatedMacroThemes": "\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d\u0e21\u0e2b\u0e20\u0e32\u0e04\u0e17\u0e35\u0e48\u0e40\u0e01\u0e35\u0e48\u0e22\u0e27\u0e02\u0e49\u0e2d\u0e07", "viewAllThemes": "\u0e14\u0e39\u0e2b\u0e31\u0e27\u0e02\u0e49\u0e2d\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14"},
    "tr.json": {"relatedMacroThemes": "\u0130lgili Makro Temalar", "viewAllThemes": "T\u00fcm Temalar\u0131 G\u00f6r"},
    "vi.json": {"relatedMacroThemes": "Ch\u1ee7 \u0111\u1ec1 V\u0129 m\u00f4 Li\u00ean quan", "viewAllThemes": "Xem T\u1ea5t c\u1ea3 Ch\u1ee7 \u0111\u1ec1"},
}

import os

messages_dir = "C:/Flowvium/messages"

for filename in os.listdir(messages_dir):
    if not filename.endswith('.json'):
        continue
    filepath = os.path.join(messages_dir, filename)
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if filename in nav_keys:
        data['nav']['intelligence'] = nav_keys[filename]

    if filename in intelligence_ns:
        data['intelligence'] = intelligence_ns[filename]

    if filename in company_additions:
        for k, v in company_additions[filename].items():
            data['company'][k] = v

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Updated {filename}")

print("Done!")
