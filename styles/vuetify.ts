import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

export default createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: 'churchToolsTheme',
    themes: {
      churchToolsTheme: {
        dark: false,
        colors: {
          primary: '#155dfc',
          'primary-darken-1': '#1753D5',
          secondary: '#FFFFFF',
          accent: '#00C950',
          surface: '#FFFFFF',
          background: '#F1F5F9',
          error: '#D32F2F',
          success: '#388E3C',
          info: '#0288D1',
          warning: '#FBC02D',
          text: '#0F172B',
          muted: '#6C757D',
          'light-blue': '#dbeafe',
          'dark-blue': '#0e204b'
        },
        variables: {
          'activated-opacity': 0,
        }
      },
    },
  },
})
