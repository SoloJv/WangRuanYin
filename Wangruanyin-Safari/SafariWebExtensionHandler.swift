//
// SafariWebExtensionHandler.swift
//
// Safari Web Extensions must be packaged inside a tiny macOS App Extension
// (the `.appex` bundle). This Swift class is the minimum "empty shell" host
// that Safari uses to run the JavaScript Web Extension. The actual behaviour
// (pinyin annotations + translations) lives entirely in the JS files that
// this Info.plist / manifest.json declare.
//
// To build: create an Xcode project using the **Safari Web Extension** app
// template, then drop all the JS/CSS/HTML + manifest.json files into the
// generated `Resources/` folder. Keep this class as the handler.
//

import SafariServices
import UIKit

class SafariWebExtensionHandler: NSObject, NSExtension {
    func beginExtension() {
        // No native actions needed: all logic is JavaScript in the bundle.
    }

    func beginRequest(with safariExtensionRequest: SafariExtensionRequest) {
        safariExtensionRequest.complete()
    }
}