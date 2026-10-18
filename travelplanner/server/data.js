// Server-only data: itinerary generation and weather.

export const TYPE_MAP = { beach:"tropical", cultural:"historical", nature:"adventure", food:"food", adventure:"adventure", wellness:"cold", shopping:"food", nightlife:"tropical", family:"historical", cold:"cold" };

export const themeLabels = { tropical:["Beach","Island","Coastal","Sun & Sand","Paradise","Shoreline","Tropical"], cold:["Winter Wonderland","Alpine","Chill & Thrill","Frosty","Snowy","Arctic","Glacial"], historical:["Heritage","Ancient","Monument","Classic","Temple","Historic","Royal"], adventure:["Extreme","Wild","Outdoor","Peak","Thrill","Expedition","Rugged"], food:["Taste","Culinary","Gastronomic","Savory","Eat","Flavours","Feast"] };

export const GENERIC_ACTIVITIES = {
  tropical:[{title:"Beachfront stroll & sunrise",desc:"Walk along the coast and watch the sunrise.",loc:"Local beach",dur:"1h",cost:"Free"},{title:"Snorkeling at a nearby reef",desc:"Explore coral gardens.",loc:"Coastal area",dur:"2h",cost:"~SGD 20"},{title:"Swim at a popular public beach",desc:"Soak up the sun and swim.",loc:"Town beach",dur:"2h",cost:"Free"},{title:"Island-hopping boat tour",desc:"Visit nearby small islands.",loc:"Archipelago",dur:"4h",cost:"~SGD 40"},{title:"Sunset beach BBQ or picnic",desc:"Grill seafood on the sand.",loc:"Beach area",dur:"2h",cost:"Varies"},{title:"Tropical fruit tasting",desc:"Sample local fruits.",loc:"Local market",dur:"1h",cost:"~SGD 5"},{title:"Kayaking through mangroves",desc:"Paddle through calm waters.",loc:"Mangrove forest",dur:"2h",cost:"~SGD 25"}],
  historical:[{title:"Old town walking tour",desc:"Explore the historic centre.",loc:"Old town",dur:"2h",cost:"Free"},{title:"National museum visit",desc:"Discover art and history.",loc:"Museum",dur:"2h",cost:"~SGD 10"},{title:"Ancient ruins",desc:"Explore early civilizations.",loc:"Historical site",dur:"1.5h",cost:"~SGD 5"},{title:"Heritage market",desc:"Browse centuries-old streets.",loc:"Heritage quarter",dur:"1.5h",cost:"Free"},{title:"Royal palace tour",desc:"Tour the seat of power.",loc:"Palace",dur:"1h",cost:"~SGD 10"},{title:"Craft workshop",desc:"Watch artisans at work.",loc:"Craft village",dur:"1h",cost:"Free"}],
  adventure:[{title:"Nature hike",desc:"Trek through a national park.",loc:"National park",dur:"3h",cost:"~SGD 5"},{title:"Wildlife tour",desc:"See native animals.",loc:"Reserve",dur:"3h",cost:"~SGD 30"},{title:"River rafting",desc:"Float down gentle rapids.",loc:"River",dur:"2h",cost:"~SGD 40"},{title:"Mountain hike",desc:"Climb for panoramic views.",loc:"Mountain trail",dur:"4h",cost:"Free"},{title:"Cave exploration",desc:"Walk through caverns.",loc:"Cave system",dur:"2h",cost:"~SGD 20"}],
  food:[{title:"Street food tour",desc:"Sample the best street eats.",loc:"Street food hub",dur:"2h",cost:"~SGD 20"},{title:"Market food crawl",desc:"Taste regional specialities.",loc:"Public market",dur:"1.5h",cost:"~SGD 10"},{title:"Cooking class",desc:"Learn traditional dishes.",loc:"Kitchen studio",dur:"3h",cost:"~SGD 40"},{title:"Night market visit",desc:"Browse and taste.",loc:"Night market",dur:"1.5h",cost:"~SGD 5-15"},{title:"Brewery tasting",desc:"Sample local beer.",loc:"Brewery",dur:"1h",cost:"~SGD 15"}],
  cold:[{title:"Alpine viewpoint",desc:"Take a cable car for views.",loc:"Mountain",dur:"2h",cost:"~SGD 25"},{title:"Glacier walk",desc:"Walk on ancient ice.",loc:"Glacier",dur:"3h",cost:"~SGD 100"},{title:"Aurora chase",desc:"See the northern lights.",loc:"Arctic region",dur:"4h",cost:"~SGD 80"},{title:"Dog sledding",desc:"Mush a team of huskies.",loc:"Snowy trail",dur:"2h",cost:"~SGD 120"},{title:"Hot springs soak",desc:"Relax in geothermal pools.",loc:"Hot springs",dur:"1.5h",cost:"~SGD 20"}]
};

export const INTEREST_CATEGORIES = {
  beach: ["beach", "tourism.sights", "leisure.park"],
  cultural: ["culture.museum", "culture.historic", "religion", "tourism.sights"],
  nature: ["leisure.park", "leisure.nature_reserve", "national_park", "tourism.sights"],
  food: ["catering.restaurant", "catering.cafe", "catering.fast_food", "catering.food_court"],
  adventure: ["sport", "leisure", "tourism.sights", "activity"],
  wellness: ["leisure", "accommodation.spa", "leisure.park"],
  shopping: ["commercial.shopping_mall", "commercial.supermarket", "commercial.marketplace"],
  nightlife: ["catering.bar", "catering.pub", "catering.nightclub", "entertainment"],
  family: ["tourism.sights", "leisure.park", "entertainment.zoo", "entertainment"],
  solo: ["tourism.sights", "catering.cafe", "culture.museum"],
  business: ["catering.restaurant", "commercial", "accommodation"],
  cold: ["tourism.sights", "sport", "leisure.park"]
};

export const CATEGORY_INDOOR = new Set([
  "culture.museum", "culture.historic", "religion", "catering.restaurant",
  "catering.cafe", "catering.fast_food", "catering.food_court", "catering.bar",
  "catering.pub", "catering.nightclub", "commercial.shopping_mall",
  "commercial.supermarket", "commercial.marketplace", "entertainment",
  "entertainment.zoo", "accommodation.spa", "accommodation"
]);

export const WEATHER_CODES = {
  0: { icon: "☀️", label: "Clear sky" },
  1: { icon: "🌤️", label: "Mainly clear" },
  2: { icon: "⛅", label: "Partly cloudy" },
  3: { icon: "☁️", label: "Overcast" },
  45: { icon: "🌫️", label: "Foggy" },
  48: { icon: "🌫️", label: "Depositing rime fog" },
  51: { icon: "🌦️", label: "Light drizzle" },
  53: { icon: "🌦️", label: "Moderate drizzle" },
  55: { icon: "🌦️", label: "Dense drizzle" },
  56: { icon: "🌧️", label: "Freezing drizzle" },
  57: { icon: "🌧️", label: "Freezing drizzle" },
  61: { icon: "🌧️", label: "Slight rain" },
  63: { icon: "🌧️", label: "Moderate rain" },
  65: { icon: "🌧️", label: "Heavy rain" },
  66: { icon: "🌧️", label: "Freezing rain" },
  67: { icon: "🌧️", label: "Freezing rain" },
  71: { icon: "🌨️", label: "Slight snow" },
  73: { icon: "🌨️", label: "Moderate snow" },
  75: { icon: "🌨️", label: "Heavy snow" },
  77: { icon: "❄️", label: "Snow grains" },
  80: { icon: "🌦️", label: "Slight rain showers" },
  81: { icon: "🌧️", label: "Moderate rain showers" },
  82: { icon: "🌧️", label: "Violent rain showers" },
  85: { icon: "🌨️", label: "Slight snow showers" },
  86: { icon: "🌨️", label: "Heavy snow showers" },
  95: { icon: "⛈️", label: "Thunderstorm" },
  96: { icon: "⛈️", label: "Thunderstorm with hail" },
  99: { icon: "⛈️", label: "Thunderstorm with hail" }
};
