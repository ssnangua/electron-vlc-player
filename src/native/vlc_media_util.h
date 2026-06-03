#pragma once

#include <string>
#include <vector>

#include "libvlc_dynload.h"

libvlc_media_t *VlcCreateMediaFromSrc(const std::string &src);
void VlcApplyMediaOptions(libvlc_media_t *media, const std::vector<std::string> &options);
bool VlcLoadMediaIntoPlayer(PlayerState *state, const std::string &src,
                              const std::vector<std::string> &options, std::string *error);
