#import <UIKit/UIKit.h>
#import <CoreFoundation/CoreFoundation.h>
#import <objc/runtime.h>

// Private SpringBoard entry point. Guarded at runtime and only installed when
// this exact selector exists on the running iOS build.
@interface SpringBoard : UIApplication
- (void)activateAssistantWithOptions:(id)options withCompletion:(id)completion;
@end

static NSString *const kAssistantURL = @"arenaassistant://activate";
static CFStringRef const kPreferenceDomain = CFSTR("com.arena.assistant");

static BOOL ArenaBridgeEnabled(void) {
    CFPreferencesAppSynchronize(kPreferenceDomain);
    CFPropertyListRef value = CFPreferencesCopyAppValue(CFSTR("replaceSystemAssistant"), kPreferenceDomain);
    BOOL enabled = !value || (CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue((CFBooleanRef)value));
    if (value) CFRelease(value);
    return enabled;
}

static void ArenaLaunchAssistant(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIApplication *application = UIApplication.sharedApplication;
        NSURL *url = [NSURL URLWithString:kAssistantURL];
        if (!application || !url) return;
        [application openURL:url options:@{} completionHandler:^(BOOL success) {
            if (!success) {
                NSLog(@"[ArenaSiriBridge] Could not open Arena Assistant; native Siri was intercepted.");
            }
        }];
    });
}

%group ArenaAssistantActivation
%hook SpringBoard

- (void)activateAssistantWithOptions:(id)options withCompletion:(id)completion {
    if (!ArenaBridgeEnabled()) {
        %orig(options, completion);
        return;
    }

    ArenaLaunchAssistant();
    if (completion) {
        ((dispatch_block_t)completion)();
    }
}

%end
%end

%ctor {
    @autoreleasepool {
        Class springBoardClass = objc_getClass("SpringBoard");
        SEL activationSelector = sel_registerName("activateAssistantWithOptions:withCompletion:");
        Method activationMethod = springBoardClass ? class_getInstanceMethod(springBoardClass, activationSelector) : NULL;
        if (activationMethod) {
            %init(ArenaAssistantActivation);
            NSLog(@"[ArenaSiriBridge] Installed guarded assistant activation redirect.");
        } else {
            NSLog(@"[ArenaSiriBridge] Unsupported SpringBoard activation selector; leaving native Siri untouched.");
        }
    }
}
