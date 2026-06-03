#pragma once

#include <map>
#include <mutex>

#include "libvlc_dynload.h"

extern std::mutex g_mutex;
extern std::map<int, PlayerState> g_players;
extern int g_next_id;

PlayerState *VlcFindPlayer(int id);

/** 首次 setMedia / play 前创建 libvlc 媒体播放器（嵌入阶段仅保留 HWND 子窗口） */
bool VlcEnsureMediaPlayer(PlayerState *state, std::string *error = nullptr);
void VlcReleaseMediaPlayer(PlayerState *state);
void VlcAttachPlayerDrawable(PlayerState *state);
/** 同步子窗口尺寸；仅在尚未绑定时 set_hwnd */
void VlcSyncPlayerDrawable(PlayerState *state);
