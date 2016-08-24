"use strict";

/* global document */
/* global console */
/* global navigator */
/* global XMLHttpRequest */

var HOUR_RADIUS = 35;
var SYMBOL_RADIUS = 25;
var SYMBOL_SIZE = 9;

var SVG_NS = "http://www.w3.org/2000/svg";
var XLINK_NS = "http://www.w3.org/1999/xlink";

function log(message) {
  document.getElementById("log").innerHTML += message + "\n";
  console.log(message);
}

/* Parses weather XML from yr.no into a weather object that maps timestamps (in
* seconds since the epoch) to forecasts. A forecast has these fields:
*
* .celsius: The forecasted temperatures in centigrades
*
* .wind_m_s: The forecasted wind speed
*
* .symbol: The weather symbol index. Resolve using
*         https://api.yr.no/weatherapi/weathericon
*/
function parseWeatherXml(weatherXml) {
  var allPrognoses = weatherXml.getElementsByTagName("time");
  log("Parsing " + allPrognoses.length + " prognoses...");

  var forecasts = {};
  for (var i = 0; i < allPrognoses.length; i++) {
    var prognosis = allPrognoses[i];

    var from = new Date(prognosis.attributes.from.value);
    var to = new Date(prognosis.attributes.to.value);
    var dh = (to.getTime() - from.getTime()) / (3600 * 1000);
    var timestamp = new Date((from.getTime() + to.getTime()) / 2);

    var forecast = forecasts[timestamp];
    if (!forecast) {
      forecast = {};
    }

    if (forecast.span_h !== undefined && forecast.span_h <= dh) {
      // There's already better data here
      continue;
    }

    forecast.span_h = dh;

    var symbolNodes = prognosis.getElementsByTagName("symbol")
    if (symbolNodes && symbolNodes.length > 0) {
      var symbolNumber = symbolNodes[0].attributes.number.value;
      forecast.symbol = symbolNumber;
    }

    var celsiusNodes = prognosis.getElementsByTagName("temperature");
    if (celsiusNodes && celsiusNodes.length > 0) {
      var celsiusValue = celsiusNodes[0].attributes.value.value;
      forecast.celsius = celsiusValue;
    }

    var windNodes = prognosis.getElementsByTagName("windSpeed");
    if (windNodes && windNodes.length > 0) {
      var windValue = windNodes[0].attributes.mps.value;
      forecast.wind_m_s = windValue;
    }

    forecasts[timestamp] = forecast;
  }

  return forecasts;
}

function fetchWeather(lat, lon) {
  // Fetch weather from yr.no
  var url =
    "https://crossorigin.me/https://api.met.no/weatherapi/locationforecast/1.9/?lat="
    + lat
    + ";lon="
    + lon;
  log("Getting weather from: " + url);

  var t0_millis = (new Date()).getTime();
  var xmlhttp = new XMLHttpRequest();
  xmlhttp.open("GET", url, false);
  xmlhttp.send();
  var t1_millis = (new Date()).getTime();
  var dt_seconds = (t1_millis - t0_millis) / 1000.0;

  // Got weather forecast
  setProgress0to2(2);

  ga('set', 'metric1', dt_seconds.toString());

  if (xmlhttp.status < 200 || xmlhttp.status > 299) {
    throw xmlhttp.statusText;
  }
  var xmldoc = xmlhttp.responseXML;
  log("Got weather XML...");
  log(xmldoc);

  return parseWeatherXml(xmldoc);
}

/**
 * @param {number} hour - What hour to get coordinates for
 * @param {number} radius - How far from the center the coordinate should
 * be, 0-50
 * @param {number} [size] - The width and height of a square we want to draw
 *
 * @returns {object} - Contains center x, y and upper left x0, y0
 */
function getCoordinates(hour, radius, size) {
  var a = 2 * Math.PI * (hour / 12.0);

  var returnMe = {};
  returnMe.x =  Math.round(Math.sin(a) * radius);
  returnMe.y = -Math.round(Math.cos(a) * radius);

  if (size !== undefined) {
    returnMe.x0 = returnMe.x - (size - 1) / 2;
    returnMe.y0 = returnMe.y - (size - 1) / 2;
  }

  return returnMe;
}

function addHourString(hour, string) {
  var text = document.createElementNS(SVG_NS, "text");
  text.setAttributeNS(null, "class", "hour");

  var coordinate = getCoordinates(hour, HOUR_RADIUS);
  text.setAttributeNS(null, "x", coordinate.x);
  text.setAttributeNS(null, "y", coordinate.y);

  text.appendChild(document.createTextNode(string));

  // Insert text before the hands to get the hands rendered on top
  var clock = document.getElementById("weatherclock");
  var hourHand = document.getElementById("hour-hand");
  clock.insertBefore(text, hourHand);
}

function addHourSymbol(hour, url) {
  var image = document.createElementNS(SVG_NS, "image");

  var coordinate = getCoordinates(hour, SYMBOL_RADIUS, SYMBOL_SIZE);
  image.setAttributeNS(null, "x", coordinate.x0);
  image.setAttributeNS(null, "y", coordinate.y0);

  image.setAttributeNS(null, "width", SYMBOL_SIZE);
  image.setAttributeNS(null, "height", SYMBOL_SIZE);

  image.setAttributeNS(XLINK_NS, "href", url);

  // Insert image before the hands to get the hands rendered on top
  var clock = document.getElementById("weatherclock");
  var hourHand = document.getElementById("hour-hand");
  clock.insertBefore(image, hourHand);
}

function renderClock(weather) {
  var now_ms = new Date().getTime();
  var start = new Date(now_ms + 0.75 * 3600 * 1000);
  var end = new Date(now_ms + 11.75 * 3600 * 1000);

  for (var timestamp in weather) {
    if (!weather.hasOwnProperty(timestamp)) {
      continue;
    }

    timestamp = new Date(timestamp);

    if (timestamp < start) {
      continue;
    }

    if (timestamp > end) {
      continue;
    }

    var hour = timestamp.getHours() + timestamp.getMinutes() / 60.0;

    var render_weather = weather[timestamp];

    var celsius = render_weather.celsius;
    if (celsius !== undefined) {
      var temperatureString = Math.round(celsius) + "°";
      addHourString(hour, temperatureString);
    }

    var symbol = render_weather.symbol;
    if (symbol !== undefined) {
      // FIXME: Replace 2100-0600 night with actual sunset / sunrise based limits
      var isNight = (hour < 7) || (hour > 20);

      // Note that we *could* download an SVG weather symbol, but that doesn't
      // work on Firefox 38.0.5 so we do PNG instead. And since cell phone screens
      // are what we're aiming for, PNG should be fine.
      var symbolUrl =
        "https://api.met.no/weatherapi/weathericon/1.1/?symbol=" +
        symbol +
        ";content_type=image/png;is_night=" +
        (isNight ? 1 : 0);

        addHourSymbol(hour, symbolUrl);
    }
  }
}

function setPosition(position) {
  var lat = position.coords.latitude;
  var lon = position.coords.longitude;
  log("Position: lat=" + lat + " lon=" + lon);

  var weather;
  try {
    weather = fetchWeather(lat, lon);
  } catch(exception) {
    ga('send', 'exception', {
      'exDescription': exception.message,
      'exFatal': true
    });

    logError("Fetching weather failed: " + exception.toString());
    return;
  }
  renderClock(weather);
}

function logError(message) {
  console.log("ERROR: " + message);
  ga('send', 'event', 'rendering', 'failure');
  alert(message);
}

function positioningError(positionError) {
  logError(positionError.message);
}

function setClock() { // eslint-disable-line no-unused-vars
  var currentHour = new Date().getHours();
  currentHour %= 12;
  var currentMinutes = new Date().getMinutes();
  var hourTransform = "rotate(" + (((currentHour * 60) + currentMinutes) * 360 / (12 * 60)) + ")";
  log("Hour transform: " + hourTransform);
  document.getElementById("hour-hand").setAttributeNS(null, "transform", hourTransform);

  var minuteTransform = "rotate(" + (currentMinutes * 360 / 60) + ")";
  log("Minute transform: " + minuteTransform);
  document.getElementById("minute-hand").setAttributeNS(null, "transform", minuteTransform);
}

function doWeather() {
  if (navigator.geolocation) {
    // One-shot position request
    log("Getting current position...");
    var t0_millis = (new Date()).getTime();
    navigator.geolocation.getCurrentPosition(function _setPosition(position) {
      var t1_millis = (new Date()).getTime();
      var dt_seconds = (t1_millis - t0_millis) / 1000.0;

      // Positioning done
      setProgress0to2(1);

      ga('set', 'metric2', dt_seconds.toString());

      setPosition(position);

      // Send collected metrics
      ga('send', 'event', 'rendering', 'success');
    }, positioningError);
  } else {
    logError("Geolocation unsupported");
  }

  setClock();
}

function setProgress0to2(progress0to2) {
  log("Progress: " + progress0to2 + "/2");

  var hour_visible = ((progress0to2 >= 1) ? "visible" : "hidden");
  var minute_visible = ((progress0to2 >= 2) ? "visible" : "hidden");

  document.getElementById("hour-hand").setAttributeNS(null, "visibility", hour_visible);
  document.getElementById("minute-hand").setAttributeNS(null, "visibility", minute_visible);
}

function main() {
  // Redirect to https, this helps with positioning in some circumstances
  var protocol = location.protocol;
  if (protocol == "http:") {
    // From http://stackoverflow.com/a/4723302/473672
    window.location.href = "https:" + window.location.href.substring(window.location.protocol.length);
    return;
  }

  doWeather();
}
