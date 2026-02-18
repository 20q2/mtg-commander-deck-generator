export {
  fetchCommanderData,
  fetchCommanderThemes,
  fetchCommanderThemeData,
  fetchPartnerThemes,
  fetchPartnerCommanderData,
  fetchPartnerThemeData,
  formatCommanderNameForUrl,
  clearCommanderCache,
  fetchPartnerPopularity,
} from './client';

export {
  getQueryForTheme,
  getKeywordsForTheme,
  getSuggestedArchetype,
  buildQueriesFromThemes,
  getAllThemeNames,
  type ThemeQuery,
} from './themeMapper';
