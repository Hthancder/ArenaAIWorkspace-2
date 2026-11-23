THEOS ?= $(HOME)/theos
TARGET := iphone:clang:latest:15.0
ARCHS := arm64
THEOS_PACKAGE_SCHEME := roothide
INSTALL_TARGET_PROCESSES := SpringBoard

include $(THEOS)/makefiles/common.mk

TWEAK_NAME := ArenaSiriBridge
ArenaSiriBridge_FILES := Tweak.xm
ArenaSiriBridge_CFLAGS := -fobjc-arc
ArenaSiriBridge_FRAMEWORKS := UIKit Foundation

include $(THEOS_MAKE_PATH)/tweak.mk
