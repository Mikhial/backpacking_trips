// Every file in this folder is a trip page.
export default {
  layout: 'trip.njk',
  permalink: data => `/trips/${data.page.fileSlug}/`
};
