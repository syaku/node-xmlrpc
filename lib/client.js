var http         = require('http')
  , https        = require('https')
  , url          = require('url')
  , Serializer   = require('./serializer')
  , Deserializer = require('./deserializer')
  , _ = require("underscore")
  , sechash = require("sechash")

/**
 * Creates a Client object for making XML-RPC method calls.
 *
 * @constructor
 * @param {Object|String} options - Server options to make the HTTP request to.
 *                                  Either a URI string
 *                                  (e.g. 'http://localhost:9090') or an object
 *                                  with fields:
 *   - {String} host              - (optional)
 *   - {Number} port
 * @param {Boolean} isSecure      - True if using https for making calls,
 *                                  otherwise false.
 * @return {Client}
 */
function Client(options, isSecure) {

  // Invokes with new if called without
  if (false === (this instanceof Client)) {
    return new Client(options, isSecure)
  }

  // If a string URI is passed in, converts to URI fields
  if (typeof options === 'string') {
    options = url.parse(options)
    options.host = options.hostname
    options.path = options.pathname
  }

  // Set the HTTP request headers
  var headers = {
    'User-Agent'     : 'NodeJS XML-RPC Client'
  , 'Content-Type'   : 'text/xml'
  , 'Accept'         : 'text/xml'
  , 'Accept-Charset' : 'UTF8'
  , 'Connection'     : 'Keep-Alive'
  }
  options.headers = options.headers || {}

  if (options.headers.Authorization == null &&
      options.basic_auth != null &&
      options.basic_auth.user != null &&
      options.basic_auth.pass != null)
  {
    var auth = options.basic_auth.user + ":" + options.basic_auth.pass
    options.headers['Authorization'] = 'Basic ' + new Buffer(auth).toString('base64')
  }

  for (var attribute in headers) {
    if (options.headers[attribute] === undefined) {
      options.headers[attribute] = headers[attribute]
    }
  }

  options.method = 'POST'
  this.options = options

  this.isSecure = isSecure
}

/**
 * Makes an XML-RPC call to the server specified by the constructor's options.
 *
 * @param {String} method     - The method name.
 * @param {Array} params      - Params to send in the call.
 * @param {Function} callback - function(error, value) { ... }
 *   - {Object|null} error    - Any errors when making the call, otherwise null.
 *   - {mixed} value          - The value returned in the method response.
 */
Client.prototype.methodCall = function methodCall(method, params, callback) {
  var xml       = Serializer.serializeMethodCall(method, params)
    , transport = this.isSecure ? https : http
    , options   = this.options

  options.headers['Content-Length'] = Buffer.byteLength(xml, 'utf8')

  var request = transport.request(options, function(response) {
    if (response.statusCode == 404) {
      callback(new Error('Not Found'));
    }else if (response.statusCode == 401) {
      var auth, authRequestParams, client, ha1, ha2, res;
      auth = parseDigest(response.headers["www-authenticate"]);
      ha1 = sechash.basicHash("md5", options.digest_auth.user+":" + auth.realm + ":"+options.digest_auth.pass);
      ha2 = sechash.basicHash("md5", request.method+":" + options.path);
      res = sechash.basicHash("md5", "" + ha1 + ":" + auth.nonce + ":1::auth:" + ha2);
      authRequestParams = {
        username: options.digest_auth.user,
        realm: auth.realm,
        nonce: auth.nonce,
        uri: options.path,
        qop: auth.qop,
        response: res,
        nc: "1",
        cnonce: ""
      };
      options.headers["Authorization"] = renderDigest(authRequestParams);
      var request2 = transport.request(options, function(response2){
        if (response2.statusCode == 404) {
          callback(new Error('Not Found'));
        }else{
          var deserializer = new Deserializer(options.responseEncoding)
          deserializer.deserializeMethodResponse(response2, callback)
        }
      });

      request2.on('error', callback)
      request2.write(xml, 'utf8')
      request2.end()

    }else {
      var deserializer = new Deserializer(options.responseEncoding)
      deserializer.deserializeMethodResponse(response, callback)
    }
  })

  request.on('error', callback)
  request.write(xml, 'utf8')
  request.end()
}

module.exports = Client

parseDigest = function(header) {
  var array;
  array = header.substring(7).split(/,\s+/);
  return _.reduce(array, (function(obj, s) {
    var parts;
    parts = s.split('=');
    if (parts.length > 2) {
      parts[1] = "" + parts[1] + "=" + parts[2];
    }
    obj[parts[0]] = parts[1].replace(/"/g, "");
    return obj;
  }), {});
};

renderDigest = function(params) {
  var s;
  s = _(_.keys(params)).reduce((function(s1, ii) {
    return "" + s1 + ", " + ii + "=\"" + params[ii] + "\"";
  }), "");
  return "Digest " + (s.substring(2));
};


