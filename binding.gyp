{
  "targets": [
    {
      "target_name": "vlc_binding",
      "sources": [
        "src/native/vlc_binding.cc",
        "src/native/libvlc_dynload.cc",
        "src/native/vlc_state.cc",
        "src/native/vlc_media_util.cc",
        "src/native/vlc_player_api.cc",
        "src/native/vlc_media_info.cc",
        "src/native/vlc_media_events.cc",
        "src/native/vlc_events.cc"
      ],
      "include_dirs": [
        "<(module_root_dir)/node_modules/node-addon-api"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=<(napi_build_version)"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/native/embed_win.cc"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [
                "/utf-8"
              ]
            }
          }
        }],
        ["OS=='mac'", {
          "sources": [
            "src/native/embed_mac.mm"
          ],
          "link_settings": {
            "libraries": [
              "-framework Cocoa"
            ]
          },
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-ObjC++"],
            "OTHER_LDFLAGS": ["-ObjC++"]
          }
        }],
        ["OS=='linux'", {
          "sources": [
            "src/native/embed_linux.cc"
          ],
          "libraries": [
            "-lX11"
          ],
          "cflags_cc": [
            "-std=c++17"
          ]
        }]
      ]
    }
  ]
}
