// Every file in this folder is a trip page.
import { tripRoutes } from '../lib/normalize.js';

export default {
  layout: 'trip.njk',
  permalink: data => `/trips/${data.page.fileSlug}/`,
  eleventyComputed: {
    // { name: gpx file } from "route" + "gpx" (a one-route trip) or the "routes" list
    trackFiles: data => tripRoutes(data)
  }
};
