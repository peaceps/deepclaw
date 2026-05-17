import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {locales} from './locale/index';
import {DEFAULT_LANG, loadUIConfig} from '@utils';

i18n
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    debug: false,
    lng: loadUIConfig<string>('lang'),
    fallbackLng: DEFAULT_LANG,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    resources: locales
  });

export default i18n;