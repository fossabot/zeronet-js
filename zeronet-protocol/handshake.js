"use strict"

const PeerRequest = require(__dirname + "/peer-request")
const PeerRequestHandler = require(__dirname + "/peer-request-handler")

function genHandshakeData(protocol, client, zeronet) {
  let d = {
    crypt: null,
    crypt_supported: protocol.crypto ? protocol.crypto.supported() : [],
    fileserver_port: zeronet.server ? zeronet.server.port : 0,
    protocol: "v2",
    port_opened: false, //TODO: implent
    rev: zeronet.rev,
    version: zeronet.version,
    target_ip: "127.0.0.1", //TODO: add
    own: true //this is later removed
  }
  if (client.isTor) {
    d.onion = 0 //TODO: add tor
  } else {
    d.peer_id = zeronet.peer_id
  }
  return d
}

function Handshake(data) {
  const self = this

  for (var p in data) {
    self[p] = data[p]
  }

  function addCMD(name, fnc, needOwn) {
    self[name] = function () {
      if (!self.linked && needOwn) throw new Error("No handshake linked")
      if (self.linked && needOwn && !self.own) return self.linked[name].apply(self.linked, arguments)
      return fnc.apply(self.linked, arguments)
    }
  }

  self.link = (h2, r) => {
    self.linked = h2
    if (!r) h2.link(self, true)
    delete self.link
  }

  addCMD("commonCrypto", () => self.crypt_supported.filter(c => self.linked.crypt_supported.indexOf(c) != -1)[0], true)

}

const debug = require("debug")

module.exports = function ZeroNetHandshake(client, protocol, zeronet, opt) {

  const log = debug("zeronet:protocol:handshake")

  let waiting = []

  function handshakeComplete(err) {
    //console.log(waiting,opt,new Error("."))
    if (!Array.isArray(waiting)) throw new Error("HandshakeError: Complete called multiple times")
    waiting.forEach(w => w(err, client.handshakeData))
    waiting = err
  }

  function handshakeInit(cb) {
    log("Start handshake", opt)
    const handshake = new Handshake(genHandshakeData(protocol, client, zeronet))

    client.cmd.handshake(handshake, (err, data) => {
      if (err) {
        handshakeComplete(err)
        return cb(err)
      }
      const remoteHandshake = new Handshake(data)

      handshake.link(remoteHandshake)

      client.handshakeData = handshake
      client.remoteHandshake = remoteHandshake

      if (protocol.crypto && handshake.commonCrypto()) {
        client.cork()
        protocol.crypto.wrap(handshake.commonCrypto(), client, {
          isServer: false
        }, err => {
          if (err) return cb(err)
          log("Finished handshake", opt)
          handshakeComplete(err)
          client.isSecure = true
          return cb(null, handshake)
        })
      } else {
        log("Finished crypto-less handshake", opt)
        handshakeComplete(err)
        return cb(null, handshake)
      }

    })
  }

  function handshakeGet(data, cb) {
    log("Got handshake", opt)
    const handshake = new Handshake(genHandshakeData(protocol, client, zeronet))
    const remoteHandshake = new Handshake(data)
    cb(null, handshake)
    handshake.link(remoteHandshake)
    client.handshakeData = handshake
    client.remoteHandshake = remoteHandshake
    if (protocol.crypto && handshake.commonCrypto()) {
      client.cork()
      protocol.crypto.wrap(handshake.commonCrypto(), client, {
        isServer: true
      }, err => {
        waiting.forEach(w => w(err, client.handshakeData))
        waiting = err
        if (err) return log("Handshake error") || log(err)
        log("Finished handshake", opt)
        handshakeComplete(err)
        client.isSecure = true
      })
    } else {
      log("Finished crypto-less handshake", opt)
      handshakeComplete(null)
    }
  }

  client.handlers.handshake = new PeerRequestHandler("handshake", module.exports.req, client, handshakeGet)
  log("use handshake", opt)

  client.handshake = handshakeInit

  client.waitForHandshake = cb => {
    if (Array.isArray(waiting)) waiting.push(cb)
    else cb(waiting, client.handshakeData)
  }

}

module.exports.def = { //Definitions are symmetric
  crypt: a => a === null || typeof a == "string",
  crypt_supported: Array.isArray,
  fileserver_port: "number",
  peer_id: "string",
  port_opened: "boolean",
  protocol: "string",
  rev: "number",
  target_ip: "string",
  version: "string",
}

module.exports.req = new PeerRequest("handshake", module.exports.def, module.exports.def)
