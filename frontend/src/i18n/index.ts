import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

const resources = {
  en: {
    translation: {
      "nav": {
        "home": "Home",
        "search": "Search",
        "favorites": "Favorites",
        "login": "Login"
      }
    }
  },
  zh: {
    translation: {
      "nav": {
        "home": "首页",
        "search": "搜索",
        "favorites": "我的收藏",
        "login": "登录"
      }
    }
  },
  ja: {
    translation: {
      "nav": {
        "home": "ホーム",
        "search": "検索",
        "favorites": "お気に入り",
        "login": "ログイン"
      }
    }
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
