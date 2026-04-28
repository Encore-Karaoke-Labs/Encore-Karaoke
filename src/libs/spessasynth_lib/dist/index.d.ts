import { MIDIPatch, KeyModifier, SoundBankManagerListEntry, SynthProcessorEventData, BasicMIDI, MIDITrack, SequencerEvent, MIDIMessage, SpessaSynthProcessor, SpessaSynthSequencer, SynthProcessorOptions, BasicSoundBank, SoundFont2WriteOptions, DLSWriteOptions, RMIDIWriteOptions, SynthesizerSnapshot, SynthMethodOptions, CustomController, MIDIController, MasterParameterType, SynthProcessorEvent, ChannelProperty, PresetList, WaveWriteOptions } from 'spessasynth_core';

declare class WorkletKeyModifierManagerWrapper {
    private keyModifiers;
    private synth;
    constructor(synth: BasicSynthesizer);
    /**
     * Modifies a single key.
     * @param channel The channel affected. Usually 0-15.
     * @param midiNote The MIDI note to change. 0-127.
     * @param options The key's modifiers.
     */
    addModifier(channel: number, midiNote: number, options: Partial<{
        velocity: number;
        patch: MIDIPatch;
        gain: number;
    }>): void;
    /**
     * Gets a key modifier.
     * @param channel The channel affected. Usually 0-15.
     * @param midiNote The MIDI note to change. 0-127.
     * @returns The key modifier if it exists.
     */
    getModifier(channel: number, midiNote: number): KeyModifier | undefined;
    /**
     * Deletes a key modifier.
     * @param channel The channel affected. Usually 0-15.
     * @param midiNote The MIDI note to change. 0-127.
     */
    deleteModifier(channel: number, midiNote: number): void;
    /**
     * Clears ALL Modifiers
     */
    clearModifiers(): void;
    private sendToWorklet;
}

type LibSBKManagerEntry = Omit<SoundBankManagerListEntry, "soundBank">;
declare class SoundBankManager {
    /**
     * All the sound banks, ordered from the most important to the least.
     */
    soundBankList: LibSBKManagerEntry[];
    private synth;
    /**
     * Creates a new instance of the sound bank manager.
     */
    constructor(synth: BasicSynthesizer);
    /**
     * The current sound bank priority order.
     * @returns The IDs of the sound banks in the current order.
     */
    get priorityOrder(): string[];
    /**
     * Rearranges the sound banks in a given order.
     * @param newList The order of sound banks, a list of identifiers, first overwrites second.
     */
    set priorityOrder(newList: string[]);
    /**
     * Adds a new sound bank buffer with a given ID.
     * @param soundBankBuffer The sound bank's buffer
     * @param id The sound bank's unique identifier.
     * @param bankOffset The sound bank's bank offset. Default is 0.
     */
    addSoundBank(soundBankBuffer: ArrayBuffer, id: string, bankOffset?: number): Promise<void>;
    /**
     * Deletes a sound bank with the given ID.
     * @param id The sound bank to delete.
     */
    deleteSoundBank(id: string): Promise<void>;
    private awaitResponse;
    private sendToWorklet;
}

type ProcessorEventCallback<T extends keyof SynthProcessorEventData> = (callbackData: SynthProcessorEventData[T]) => unknown;
declare class SynthEventHandler {
    /**
     * The time delay before an event is called.
     * Set to 0 to disable it.
     */
    timeDelay: number;
    /**
     * The main list of events.
     * @private
     */
    private readonly events;
    /**
     * Adds a new event listener.
     * @param event The event to listen to.
     * @param id The unique identifier for the event. It can be used to overwrite existing callback with the same ID.
     * @param callback The callback for the event.
     */
    addEvent<T extends keyof SynthProcessorEventData>(event: T, id: string, callback: ProcessorEventCallback<T>): void;
    /**
     * Removes an event listener
     * @param name The event to remove a listener from.
     * @param id The unique identifier for the event to remove.
     */
    removeEvent<T extends keyof SynthProcessorEventData>(name: T, id: string): void;
    /**
     * Calls the given event.
     * INTERNAL USE ONLY!
     * @internal
     */
    callEventInternal<T extends keyof SynthProcessorEventData>(name: T, eventData: SynthProcessorEventData[T]): void;
}

declare const songChangeType: {
    readonly shuffleOn: 1;
    readonly shuffleOff: 2;
    readonly index: 3;
};
type SongChangeType = (typeof songChangeType)[keyof typeof songChangeType];

declare class MIDIDataTrack extends MIDITrack {
    /**
     * THIS DATA WILL BE EMPTY! USE sequencer.getMIDI() TO GET THE ACTUAL DATA!
     */
    events: never[];
    constructor(track: MIDITrack);
}
/**
 * A simplified version of the MIDI, accessible at all times from the Sequencer.
 * Use getMIDI() to get the actual sequence.
 * This class contains all properties that MIDI does, except for tracks and the embedded sound bank.
 */
declare class MIDIData extends BasicMIDI {
    tracks: MIDIDataTrack[];
    /**
     * THIS DATA WILL BE EMPTY! USE sequencer.getMIDI() TO GET THE ACTUAL DATA!
     */
    embeddedSoundBank: undefined;
    /**
     * The byte length of the sound bank if it exists.
     */
    readonly embeddedSoundBankSize?: number;
    constructor(mid: BasicMIDI);
}

interface SequencerOptions {
    /**
     * If true, the sequencer will skip to the first note.
     */
    skipToFirstNoteOn: boolean;
    /**
     * The initial playback rate, defaults to 1.0 (normal speed).
     */
    initialPlaybackRate: number;
}
type SequencerMessage = {
    [K in keyof SequencerMessageData]: {
        type: K;
        data: SequencerMessageData[K];
        id: number;
    };
}[keyof SequencerMessageData];
interface SequencerMessageData {
    loadNewSongList: SuppliedMIDIData[];
    pause: null;
    play: null;
    setTime: number;
    changeMIDIMessageSending: boolean;
    setPlaybackRate: number;
    setLoopCount: number;
    changeSong: {
        changeType: SongChangeType;
        data?: number;
    };
    getMIDI: null;
    setSkipToFirstNote: boolean;
}
type SequencerReturnMessage = (Exclude<SequencerEvent, {
    type: "songListChange";
}> & {
    id: number;
}) | (Extract<SequencerEvent, {
    type: "songListChange";
}> & {
    data: {
        shuffledSongIndexes: number[];
    };
    id: number;
}) | {
    type: "getMIDI";
    data: BasicMIDI;
    id: number;
} | {
    type: "midiError";
    data: Error;
    id: number;
} | {
    type: "sync";
    data: number;
    id: number;
};
/**
 * Sequencer.js
 * purpose: plays back the midi file decoded by midi_loader.js, including support for multichannel midis
 * (adding channels when more than one midi port is detected)
 * note: this is the sequencer class that runs on the main thread
 * and only communicates with the worklet sequencer which does the actual playback
 */
type SuppliedMIDIData = BasicMIDI | {
    /**
     * The binary data of the file.
     */
    binary: ArrayBuffer;
    /**
     * The file name of this file as a fallback.
     */
    fileName?: string;
};
interface WorkletSequencerEventType {
    /**
     * New song.
     */
    songChange: MIDIData;
    /**
     * New time.
     */
    timeChange: number;
    /**
     * No data.
     */
    songEnded: null;
    metaEvent: {
        event: MIDIMessage;
        trackNumber: number;
    };
    textEvent: {
        /**
         * The raw event.
         */
        event: MIDIMessage;
        /**
         * If the text is a lyric, the index of the lyric in BasicMIDI's "lyrics" property, otherwise -1.
         */
        lyricsIndex: number;
    };
    midiError: Error;
}

type PostMessageSynthCore = (data: BasicSynthesizerReturnMessage, transfer?: Transferable[]) => unknown;
/**
 * The interface for the audio processing code that uses spessasynth_core and runs on a separate thread.
 */
declare abstract class BasicSynthesizerCore {
    readonly synthesizer: SpessaSynthProcessor;
    readonly sequencers: SpessaSynthSequencer[];
    protected readonly post: PostMessageSynthCore;
    protected lastSequencerSync: number;
    /**
     * Indicates if the processor is alive.
     * @protected
     */
    protected alive: boolean;
    protected readonly enableEventSystem: boolean;
    protected constructor(sampleRate: number, options: Partial<SynthProcessorOptions>, postMessage: PostMessageSynthCore);
    protected createNewSequencer(): void;
    protected postReady<K extends keyof SynthesizerReturn>(type: K, data: SynthesizerReturn[K], transferable?: Transferable[]): void;
    protected postProgress<K extends keyof SynthesizerProgress>(type: K, data: SynthesizerProgress[K]): void;
    protected destroy(): void;
    protected handleMessage(m: BasicSynthesizerMessage): void;
}

declare class WorkerSynthesizerCore extends BasicSynthesizerCore {
    /**
     * The message port to the playback audio worklet.
     */
    readonly workletMessagePort: MessagePort;
    protected readonly compressionFunction?: WorkerSampleEncodingFunction;
    /**
     * Creates a new worker synthesizer core: the synthesizer that runs in the worker.
     * Most parameters here are provided with the first message that is posted to the worker by the WorkerSynthesizer.
     * @param synthesizerConfiguration The data from the first message sent from WorkerSynthesizer.
     * Listen for the first event and use its data to initialize this class.
     * @param workletMessagePort The first port from the first message sent from WorkerSynthesizer.
     * @param mainThreadCallback postMessage function or similar.
     * @param compressionFunction Optional function for compressing SF3 banks.
     */
    constructor(synthesizerConfiguration: {
        sampleRate: number;
        initialTime: number;
    }, workletMessagePort: MessagePort, mainThreadCallback: typeof Worker.prototype.postMessage, compressionFunction?: WorkerSampleEncodingFunction);
    /**
     * Handles a message received from the main thread.
     * @param m The message received.
     */
    handleMessage(m: BasicSynthesizerMessage): void;
    protected getBank(opts: WorkerBankWriteOptions): BasicSoundBank;
    protected stopAudioLoop(): void;
    protected startAudioLoop(): void;
    protected destroy(): void;
    protected process(): void;
}

interface WorkerRenderAudioOptions {
    /**
     * Extra fadeout time after the song finishes, in seconds.
     */
    extraTime: number;
    /**
     * If channels should be rendered separately.
     */
    separateChannels: boolean;
    /**
     * The amount of times to loop the song.
     */
    loopCount: number;
    /**
     * The function that tracks the rendering progress.
     * @param progress mapped 0 to 1.
     * @param stage 0 is a dry pass, 1 is adding effects.
     */
    progressCallback?: (progress: number, stage: number) => unknown;
    /**
     * If the current parameters of the synthesizer should be preserved.
     */
    preserveSynthParams: boolean;
    /**
     * If the effects should be enabled.
     */
    enableEffects: boolean;
    /**
     * Which sequencer to render. Defaults to the first one (0).
     */
    sequencerID: number;
}

interface PassedProcessorParameters {
    /**
     * If the synthesizer should send events.
     */
    enableEventSystem: boolean;
    /**
     * If the synth should use one output with 32 channels (2 audio channels for each midi channel).
     */
    oneOutput: boolean;
}
interface OfflineRenderWorkletData {
    /**
     * The MIDI to render.
     */
    midiSequence: BasicMIDI;
    /**
     * The snapshot to apply.
     */
    snapshot?: SynthesizerSnapshot;
    /**
     * The amount times to loop the song.
     */
    loopCount: number;
    /**
     * The list of sound banks to render this file with.
     */
    soundBankList: {
        bankOffset: number;
        soundBankBuffer: ArrayBuffer;
    }[];
    /**
     * The options to pass to the sequencer.
     */
    sequencerOptions: Partial<SequencerOptions>;
}
interface WorkletSBKManagerData {
    addSoundBank: {
        soundBankBuffer: ArrayBuffer;
        id: string;
        bankOffset: number;
    };
    deleteSoundBank: string;
    rearrangeSoundBanks: string[];
}
interface WorkletKMManagerData {
    addMapping: {
        channel: number;
        midiNote: number;
        mapping: KeyModifier;
    };
    deleteMapping: {
        channel: number;
        midiNote: number;
    };
    clearMappings: null;
}
type BasicSynthesizerMessage = {
    [K in keyof BasicSynthesizerMessageData]: {
        channelNumber: number;
        type: K;
        data: BasicSynthesizerMessageData[K];
    };
}[keyof BasicSynthesizerMessageData];
interface WorkerBankWriteOptions {
    /**
     * Trim the sound bank to only include samples used in the current MIDI file.
     */
    trim: boolean;
    /**
     * Which sequencer to grab the MIDI from if trimming. Defaults to the first one (0).
     */
    sequencerID: number;
    /**
     * The sound bank ID in the sound bank manager to write.
     */
    bankID: string;
    /**
     * If the embedded sound bank should be written instead if it exists.
     */
    writeEmbeddedSoundBank: boolean;
}
type WorkerDLSWriteOptions = Omit<DLSWriteOptions, "progressFunction"> & WorkerBankWriteOptions;
type WorkerSoundFont2WriteOptions = Omit<SoundFont2WriteOptions, "compressionFunction" | "progressFunction"> & WorkerBankWriteOptions & {
    /**
     * The compression quality to call your provided compressionFunction with, if compressing.
     */
    compressionQuality: number;
};
type WorkerSampleEncodingFunction = (audioData: Float32Array, sampleRate: number, quality: number) => Promise<Uint8Array>;
type WorkerRMIDIWriteOptions = Omit<RMIDIWriteOptions, "soundBank"> & (({
    format: "sf2";
} & WorkerSoundFont2WriteOptions) | ({
    format: "dls";
} & WorkerDLSWriteOptions));
interface BasicSynthesizerMessageData {
    workerInitialization: {
        sampleRate: number;
        currentTime: number;
    };
    renderAudio: {
        sampleRate: number;
        options: WorkerRenderAudioOptions;
    };
    writeSF2: WorkerSoundFont2WriteOptions;
    writeDLS: WorkerDLSWriteOptions;
    writeRMIDI: WorkerRMIDIWriteOptions;
    startOfflineRender: OfflineRenderWorkletData;
    midiMessage: {
        messageData: Uint8Array;
        channelOffset: number;
        options: SynthMethodOptions;
    };
    ccReset: null;
    stopAll: number;
    muteChannel: boolean;
    addNewChannel: null;
    customCcChange: {
        ccNumber: CustomController;
        ccValue: number;
    };
    transposeChannel: {
        semitones: number;
        force: boolean;
    };
    setDrums: boolean;
    lockController: {
        controllerNumber: MIDIController | -1;
        isLocked: boolean;
    };
    sequencerSpecific: SequencerMessage;
    requestSynthesizerSnapshot: null;
    requestNewSequencer: null;
    setLogLevel: {
        enableInfo: boolean;
        enableWarning: boolean;
        enableGroup: boolean;
    };
    setMasterParameter: {
        [K in keyof MasterParameterType]: {
            type: K;
            data: MasterParameterType[K];
        };
    }[keyof MasterParameterType];
    soundBankManager: {
        [K in keyof WorkletSBKManagerData]: {
            type: K;
            data: WorkletSBKManagerData[K];
        };
    }[keyof WorkletSBKManagerData];
    keyModifierManager: {
        [K in keyof WorkletKMManagerData]: {
            type: K;
            data: WorkletKMManagerData[K];
        };
    }[keyof WorkletKMManagerData];
    destroyWorklet: null;
}
interface BasicSynthesizerReturnMessageData {
    eventCall: SynthProcessorEvent;
    sequencerReturn: SequencerReturnMessage;
    isFullyInitialized: {
        [K in keyof SynthesizerReturn]: {
            type: K;
            data: SynthesizerReturn[K];
        };
    }[keyof SynthesizerReturn];
    soundBankError: Error;
    renderingProgress: {
        [K in keyof SynthesizerProgress]: {
            type: K;
            data: SynthesizerProgress[K];
        };
    }[keyof SynthesizerProgress];
}
type BasicSynthesizerReturnMessage = {
    [K in keyof BasicSynthesizerReturnMessageData]: {
        type: K;
        data: BasicSynthesizerReturnMessageData[K];
        currentTime: number;
    };
}[keyof BasicSynthesizerReturnMessageData];
interface SynthesizerProgress {
    renderAudio: number;
    workerSynthWriteFile: {
        sampleName: string;
        sampleIndex: number;
        sampleCount: number;
    };
}
interface SynthesizerReturn {
    sf3Decoder: null;
    soundBankManager: null;
    startOfflineRender: null;
    synthesizerSnapshot: SynthesizerSnapshot;
    renderAudio: {
        effects: [Float32Array, Float32Array];
        dry: [Float32Array, Float32Array][];
    };
    workerSynthWriteFile: {
        /**
         * The binary data of the file.
         */
        binary: ArrayBuffer;
        /**
         * The suggested name of the file.
         */
        fileName: string;
    };
}

interface SynthConfig {
    /**
     * If the synth should use one output with 32 channels (2 audio channels for each midi channel).
     */
    oneOutput: boolean;
    /**
     * @deprecated Deprecated parameter, does nothing.
     */
    initializeChorusProcessor?: boolean;
    /**
     * @deprecated Deprecated parameter, does nothing.
     */
    initializeReverbProcessor?: boolean;
    /**
     * Custom audio node creation functions for Web Audio wrappers, such as standardized-audio-context.
     * Pass undefined to use the Web Audio API.
     */
    audioNodeCreators?: AudioNodeCreators;
    /**
     * If the event system should be enabled. This can only be set once.
     */
    enableEventSystem: boolean;
}
interface AudioNodeCreators {
    /**
     * A custom creator for an AudioWorkletNode.
     * @param context
     * @param workletName
     * @param options
     */
    worklet: (context: BaseAudioContext, workletName: string, options?: AudioWorkletNodeOptions & {
        processorOptions: PassedProcessorParameters;
    }) => AudioWorkletNode;
}

declare abstract class BasicSynthesizer {
    /**
     * Allows managing the sound bank list.
     */
    readonly soundBankManager: SoundBankManager;
    /**
     * Allows managing key modifications.
     */
    readonly keyModifierManager: WorkletKeyModifierManagerWrapper;
    /**
     * Allows setting up custom event listeners for the synthesizer.
     */
    readonly eventHandler: SynthEventHandler;
    /**
     * Synthesizer's parent AudioContext instance.
     */
    readonly context: BaseAudioContext;
    /**
     * Synth's current channel properties.
     */
    readonly channelProperties: ChannelProperty[];
    /**
     * The current preset list.
     */
    presetList: PresetList;
    /**
     * INTERNAL USE ONLY!
     * @internal
     * All sequencer callbacks
     */
    sequencers: ((m: SequencerReturnMessage) => unknown)[];
    /**
     * Resolves when the synthesizer is ready.
     */
    readonly isReady: Promise<unknown>;
    /**
     * Legacy parameter.
     * @deprecated
     */
    readonly reverbProcessor: undefined;
    /**
     * Legacy parameter.
     * @deprecated
     */
    readonly chorusProcessor: undefined;
    /**
     * INTERNAL USE ONLY!
     * @internal
     */
    readonly post: (data: BasicSynthesizerMessage, transfer?: Transferable[]) => unknown;
    protected readonly worklet: AudioWorkletNode;
    /**
     * The new channels will have their audio sent to the modulated output by this constant.
     * what does that mean?
     * e.g., if outputsAmount is 16, then channel's 16 audio data will be sent to channel 0
     */
    protected readonly _outputsAmount = 16;
    /**
     * The current amount of MIDI channels the synthesizer has.
     */
    channelsAmount: number;
    protected readonly masterParameters: MasterParameterType;
    protected resolveMap: Map<keyof SynthesizerReturn, (data: SynthesizerReturn[keyof SynthesizerReturn]) => unknown>;
    protected renderingProgressTracker: Map<keyof SynthesizerProgress, ((args: number) => unknown) | ((args: {
        sampleName: string;
        sampleIndex: number;
        sampleCount: number;
    }) => unknown)>;
    /**
     * Creates a new instance of a synthesizer.
     * @param worklet The AudioWorkletNode to use.
     * @param postFunction The internal post function.
     * @param config Optional configuration for the synthesizer.
     */
    protected constructor(worklet: AudioWorkletNode, postFunction: (data: BasicSynthesizerMessage, transfer?: Transferable[]) => unknown, config: SynthConfig);
    /**
     * Current voice amount
     */
    protected _voicesAmount: number;
    /**
     * The current number of voices playing.
     */
    get voicesAmount(): number;
    /**
     * The audioContext's current time.
     */
    get currentTime(): number;
    /**
     * Connects from a given node.
     * @param destinationNode The node to connect to.
     */
    connect(destinationNode: AudioNode): AudioNode;
    /**
     * Disconnects from a given node.
     * @param destinationNode The node to disconnect from.
     */
    disconnect(destinationNode?: AudioNode): AudioNode | undefined;
    /**
     * Sets the SpessaSynth's log level in the processor.
     * @param enableInfo Enable info (verbose)
     * @param enableWarning Enable warnings (unrecognized messages)
     * @param enableGroup Enable groups (to group a lot of logs)
     */
    setLogLevel(enableInfo: boolean, enableWarning: boolean, enableGroup: boolean): void;
    /**
     * Gets a master parameter from the synthesizer.
     * @param type The parameter to get.
     * @returns The parameter value.
     */
    getMasterParameter<K extends keyof MasterParameterType>(type: K): MasterParameterType[K];
    /**
     * Sets a master parameter to a given value.
     * @param type The parameter to set.
     * @param value The value to set.
     */
    setMasterParameter<K extends keyof MasterParameterType>(type: K, value: MasterParameterType[K]): void;
    /**
     * Gets a complete snapshot of the synthesizer, effects.
     */
    getSnapshot(): Promise<SynthesizerSnapshot>;
    /**
     * Adds a new channel to the synthesizer.
     */
    addNewChannel(): void;
    /**
     * DEPRECATED, please don't use it!
     * @deprecated
     */
    setVibrato(channel: number, value: {
        delay: number;
        depth: number;
        rate: number;
    }): void;
    /**
     * Connects a given channel output to the given audio node.
     * Note that this output is only meant for visualization and may be silent when Insertion Effect for this channel is enabled.
     * @param targetNode The node to connect to.
     * @param channelNumber The channel number to connect to, will be rolled over if value is greater than 15.
     * @returns The target node.
     */
    connectChannel(targetNode: AudioNode, channelNumber: number): AudioNode;
    /**
     * Disconnects a given channel output to the given audio node.
     * @param targetNode The node to disconnect from.
     * @param channelNumber The channel number to connect to, will be rolled over if value is greater than 15.
     */
    disconnectChannel(targetNode: AudioNode, channelNumber: number): void;
    /**
     * Connects the individual audio outputs to the given audio nodes.
     * Note that these outputs is only meant for visualization and may be silent when Insertion Effect for this channel is enabled.
     * @param audioNodes Exactly 16 outputs.
     */
    connectIndividualOutputs(audioNodes: AudioNode[]): void;
    /**
     * Disconnects the individual audio outputs from the given audio nodes.
     * @param audioNodes Exactly 16 outputs.
     */
    disconnectIndividualOutputs(audioNodes: AudioNode[]): void;
    /**
     * Disables the GS NRPN parameters like vibrato or drum key tuning.
     * @deprecated Deprecated! Please use master parameters
     */
    disableGSNPRNParams(): void;
    /**
     * Sends a raw MIDI message to the synthesizer.
     * @param message the midi message, each number is a byte.
     * @param channelOffset the channel offset of the message.
     * @param eventOptions additional options for this command.
     */
    sendMessage(message: Iterable<number>, channelOffset?: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Starts playing a note
     * @param channel Usually 0-15: the channel to play the note.
     * @param midiNote 0-127 the key number of the note.
     * @param velocity 0-127 the velocity of the note (generally controls loudness).
     * @param eventOptions Additional options for this command.
     */
    noteOn(channel: number, midiNote: number, velocity: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Stops playing a note.
     * @param channel Usually 0-15: the channel of the note.
     * @param midiNote {number} 0-127 the key number of the note.
     * @param eventOptions Additional options for this command.
     */
    noteOff(channel: number, midiNote: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Stops all notes.
     * @param force If the notes should immediately be stopped, defaults to false.
     */
    stopAll(force?: boolean): void;
    /**
     * Changes the given controller
     * @param channel Usually 0-15: the channel to change the controller.
     * @param controllerNumber 0-127 the MIDI CC number.
     * @param controllerValue 0-127 the controller value.
     * @param eventOptions Additional options for this command.
     */
    controllerChange(channel: number, controllerNumber: MIDIController, controllerValue: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Resets all controllers (for every channel)
     */
    resetControllers(): void;
    /**
     * Causes the given midi channel to ignore controller messages for the given controller number.
     * @param channel Usually 0-15: the channel to lock.
     * @param controllerNumber 0-127 MIDI CC number.
     * @param isLocked True if locked, false if unlocked.
     * @remarks
     *  Controller number -1 locks the preset.
     */
    lockController(channel: number, controllerNumber: MIDIController | -1, isLocked: boolean): void;
    /**
     * Applies pressure to a given channel.
     * @param channel Usually 0-15: the channel to change the controller.
     * @param pressure 0-127: the pressure to apply.
     * @param eventOptions Additional options for this command.
     */
    channelPressure(channel: number, pressure: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Applies pressure to a given note.
     * @param channel Usually 0-15: the channel to change the controller.
     * @param midiNote 0-127: the MIDI note.
     * @param pressure 0-127: the pressure to apply.
     * @param eventOptions Additional options for this command.
     */
    polyPressure(channel: number, midiNote: number, pressure: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Sets the pitch of the given channel.
     * @param channel Usually 0-15: the channel to change pitch.
     * @param value The bend of the MIDI pitch wheel message. 0 - 16384
     * @param eventOptions Additional options for this command.
     */
    pitchWheel(channel: number, value: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Sets the channel's pitch wheel range, in semitones.
     * @param channel Usually 0-15: the channel to change.
     * @param range The bend range in semitones.
     * @param eventOptions Additional options for this command.
     */
    pitchWheelRange(channel: number, range: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Changes the program for a given channel
     * @param channel Usually 0-15: the channel to change.
     * @param programNumber 0-127 the MIDI patch number.
     * @param eventOptions Additional options for this command.
     */
    programChange(channel: number, programNumber: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Transposes the channel by given number of semitones.
     * @param channel The channel number.
     * @param semitones The transposition of the channel, it can be a float.
     * @param force Defaults to false, if true transposes the channel even if it's a drum channel.
     */
    transposeChannel(channel: number, semitones: number, force?: boolean): void;
    /**
     * Mutes or unmutes the given channel.
     * @param channel Usually 0-15: the channel to mute.
     * @param isMuted Indicates if the channel is muted.
     */
    muteChannel(channel: number, isMuted: boolean): void;
    /**
     * Sends a MIDI Sysex message to the synthesizer.
     * @param messageData The message's data, excluding the F0 byte, but including the F7 at the end.
     * @param channelOffset Channel offset for the system exclusive message, defaults to zero.
     * @param eventOptions Additional options for this command.
     */
    systemExclusive(messageData: number[] | Iterable<number> | Uint8Array, channelOffset?: number, eventOptions?: SynthMethodOptions): void;
    /**
     * Tune MIDI keys of a given program using the MIDI Tuning Standard.
     * @param program  0 - 127 the MIDI program number to use.
     * @param tunings The keys and their tunings.
     * TargetPitch of -1 sets the tuning for this key to be tuned regularly.
     */
    tuneKeys(program: number, tunings: {
        sourceKey: number;
        targetPitch: number;
    }[]): void;
    /**
     * Toggles drums on a given channel.
     * @param channel The channel number.
     * @param isDrum If the channel should be drums.
     */
    setDrums(channel: number, isDrum: boolean): void;
    /**
     * Yes please!
     */
    reverbateEverythingBecauseWhyNot(): "That's the spirit!";
    /**
     * INTERNAL USE ONLY!
     * @param type INTERNAL USE ONLY!
     * @param resolve INTERNAL USE ONLY!
     * @internal
     */
    awaitWorkerResponse<K extends keyof SynthesizerReturn>(type: K, resolve: (data: SynthesizerReturn[K]) => unknown): void;
    /**
     * INTERNAL USE ONLY!
     * @param callback the sequencer callback
     * @internal
     */
    assignNewSequencer(callback: (m: SequencerReturnMessage) => unknown): number;
    protected assignProgressTracker<K extends keyof SynthesizerProgress>(type: K, progressFunction: (args: SynthesizerProgress[K]) => unknown): void;
    protected revokeProgressTracker<K extends keyof SynthesizerProgress>(type: K): void;
    protected _sendInternal(message: Iterable<number>, channelOffset: number, eventOptions: Partial<SynthMethodOptions>): void;
    /**
     * Handles the messages received from the worklet.
     */
    protected handleMessage(m: BasicSynthesizerReturnMessage): void;
    protected addNewChannelInternal(post: boolean): void;
    protected workletResponds<K extends keyof SynthesizerReturn>(type: K, data: SynthesizerReturn[K]): void;
}

/**
 * This synthesizer uses an audio worklet node containing the processor.
 */
declare class WorkletSynthesizer extends BasicSynthesizer {
    /**
     * Creates a new instance of an AudioWorklet-based synthesizer.
     * @param context The audio context.
     * @param config Optional configuration for the synthesizer.
     */
    constructor(context: BaseAudioContext, config?: Partial<SynthConfig>);
    /**
     * Starts an offline audio render.
     * @param config The configuration to use.
     * @remarks
     * Call this method immediately after you've set up the synthesizer.
     * Do NOT call any other methods after initializing before this one.
     * Chromium seems to ignore worklet messages for OfflineAudioContext.
     */
    startOfflineRender(config: OfflineRenderWorkletData): Promise<void>;
    /**
     * Destroys the synthesizer instance.
     */
    destroy(): void;
}

type WorkerSynthWriteOptions<K> = K & {
    progressFunction?: (args: SynthesizerProgress["workerSynthWriteFile"]) => unknown;
};
/**
 * This synthesizer uses a Worker containing the processor and an audio worklet node for playback.
 */
declare class WorkerSynthesizer extends BasicSynthesizer {
    /**
     * Time offset for syncing with the synth
     * @private
     */
    private timeOffset;
    /**
     * Creates a new instance of a Worker-based synthesizer.
     * @param context The audio context.
     * @param workerPostMessage The postMessage for the worker containing the synthesizer core.
     * @param config Optional configuration for the synthesizer.
     */
    constructor(context: BaseAudioContext, workerPostMessage: typeof Worker.prototype.postMessage, config?: Partial<SynthConfig>);
    get currentTime(): number;
    /**
     * Registers an audio worklet for the WorkerSynthesizer.
     * @param context The context to register the worklet for.
     * @param maxQueueSize The maximum amount of 128-sample chunks to store in the worklet. Higher values result in less breakups but higher latency.
     */
    static registerPlaybackWorklet(context: BaseAudioContext, maxQueueSize?: number): Promise<void>;
    /**
     * Handles a return message from the Worker.
     * @param e The event received from the Worker.
     */
    handleWorkerMessage(e: BasicSynthesizerReturnMessage): void;
    /**
     * Writes a DLS file directly in the worker.
     * @param options Options for writing the file.
     * @returns The file array buffer and its corresponding name.
     */
    writeDLS(options?: Partial<WorkerSynthWriteOptions<WorkerDLSWriteOptions>>): Promise<SynthesizerReturn["workerSynthWriteFile"]>;
    /**
     * Writes an SF2/SF3 file directly in the worker.
     * @param options Options for writing the file.
     * @returns The file array buffer and its corresponding name.
     */
    writeSF2(options?: Partial<WorkerSynthWriteOptions<WorkerSoundFont2WriteOptions>>): Promise<SynthesizerReturn["workerSynthWriteFile"]>;
    /**
     * Writes an embedded MIDI (RMIDI) file directly in the worker.
     * @param options Options for writing the file.
     * @returns The file array buffer.
     */
    writeRMIDI(options?: Partial<WorkerSynthWriteOptions<WorkerRMIDIWriteOptions>>): Promise<ArrayBuffer>;
    /**
     * Renders the current song in the connected sequencer to Float32 buffers.
     * @param sampleRate The sample rate to use, in Hertz.
     * @param renderOptions Extra options for the render.
     * @returns A single audioBuffer if separate channels were not enabled, otherwise 16.
     * @remarks
     * This stops the synthesizer.
     */
    renderAudio(sampleRate: number, renderOptions?: Partial<WorkerRenderAudioOptions>): Promise<AudioBuffer[]>;
}

type SequencerEventCallback<T extends keyof WorkletSequencerEventType> = (callbackData: WorkletSequencerEventType[T]) => unknown;
declare class SeqEventHandler {
    /**
     * The time delay before an event is called.
     * Set to 0 to disable it.
     */
    timeDelay: number;
    private readonly events;
    /**
     * Adds a new event listener.
     * @param event The event to listen to.
     * @param id The unique identifier for the event. It can be used to overwrite existing callback with the same ID.
     * @param callback The callback for the event.
     */
    addEvent<T extends keyof WorkletSequencerEventType>(event: T, id: string, callback: SequencerEventCallback<T>): void;
    /**
     * Removes an event listener
     * @param name The event to remove a listener from.
     * @param id The unique identifier for the event to remove.
     */
    removeEvent<T extends keyof WorkletSequencerEventType>(name: T, id: string): void;
    /**
     * Calls the given event.
     * Internal use only.
     * @internal
     */
    callEventInternal<T extends keyof WorkletSequencerEventType>(name: T, eventData: WorkletSequencerEventType[T]): void;
}

declare class Sequencer {
    /**
     * The current MIDI data for all songs, like the midiData property.
     */
    songListData: MIDIData[];
    /**
     * Allows setting up custom event listeners for the sequencer.
     */
    eventHandler: SeqEventHandler;
    /**
     * Indicates whether the sequencer has finished playing a sequence.
     */
    isFinished: boolean;
    /**
     * The synthesizer attached to this sequencer.
     */
    readonly synth: BasicSynthesizer;
    /**
     * The current MIDI data, with the exclusion of the embedded sound bank and event data.
     */
    midiData?: MIDIData;
    /**
     * The MIDI port to play to.
     */
    private midiOut?;
    private isLoading;
    /**
     * Indicates if the sequencer is paused.
     * Paused if a number, undefined if playing.
     */
    private pausedTime?;
    private getMIDICallback?;
    private highResTimeOffset;
    /**
     * Absolute playback startTime, bases on the synth's time.
     */
    private absoluteStartTime;
    /**
     * For sending the messages to the correct SpessaSynthSequencer in core
     */
    private readonly sequencerID;
    /**
     * Creates a new MIDI sequencer for playing back MIDI files.
     * @param synth synth to send events to.
     * @param options the sequencer's options.
     */
    constructor(synth: BasicSynthesizer, options?: Partial<SequencerOptions>);
    private _shuffledSongIndexes;
    /**
     * The shuffled song indexes.
     * This is used when shuffleMode is enabled.
     */
    get shuffledSongIndexes(): number[];
    private _songIndex;
    /**
     * The current song number in the playlist.
     * If shuffle Mode is enabled, this is the index of the shuffled song list.
     */
    get songIndex(): number;
    /**
     * The current song number in the playlist.
     * If shuffle Mode is enabled, this is the index of the shuffled song list.
     */
    set songIndex(value: number);
    private _currentTempo;
    /**
     * Current song's tempo in BPM.
     */
    get currentTempo(): number;
    /**
     * The current sequence's length, in seconds.
     */
    get duration(): number;
    private _songsAmount;
    get songsAmount(): number;
    private _skipToFirstNoteOn;
    /**
     * Indicates if the sequencer should skip to first note on.
     */
    get skipToFirstNoteOn(): boolean;
    /**
     * Indicates if the sequencer should skip to first note on.
     */
    set skipToFirstNoteOn(val: boolean);
    /**
     * Internal loop count marker (-1 is infinite).
     */
    private _loopCount;
    /**
     * The current remaining number of loops. -1 means infinite looping.
     */
    get loopCount(): number;
    /**
     * The current remaining number of loops. -1 means infinite looping.
     */
    set loopCount(val: number);
    /**
     * Controls the playback's rate.
     */
    private _playbackRate;
    /**
     * Controls the playback's rate.
     */
    get playbackRate(): number;
    /**
     * Controls the playback's rate.
     */
    set playbackRate(value: number);
    private _shuffleSongs;
    /**
     * Controls if the sequencer should shuffle the songs in the song list.
     * If true, the sequencer will play the songs in a random order.
     *
     * Songs are shuffled on a `loadNewSongList` call.
     */
    get shuffleSongs(): boolean;
    /**
     * Controls if the sequencer should shuffle the songs in the song list.
     * If true, the sequencer will play the songs in a random order.
     *
     * Songs are shuffled on a `loadNewSongList` call.
     */
    set shuffleSongs(value: boolean);
    /**
     * Current playback time, in seconds.
     */
    get currentTime(): number;
    /**
     * Current playback time, in seconds.
     */
    set currentTime(time: number);
    /**
     * A smoothed version of currentTime.
     * Use for visualization as it's not affected by the audioContext stutter.
     */
    get currentHighResolutionTime(): number;
    /**
     * True if paused, false if playing or stopped.
     */
    get paused(): boolean;
    /**
     * Gets the current MIDI File.
     */
    getMIDI(): Promise<BasicMIDI>;
    /**
     * Loads a new song list.
     * @param midiBuffers The MIDI files to play.
     */
    loadNewSongList(midiBuffers: SuppliedMIDIData[]): void;
    /**
     * Connects a given output to the sequencer.
     * @param output The output to connect. Pass undefined to use the connected synthesizer.
     */
    connectMIDIOutput(output?: {
        send: (data: number[]) => unknown;
    }): void;
    /**
     * Pauses the playback.
     */
    pause(): void;
    /**
     * Starts or resumes the playback.
     */
    play(): void;
    private handleMessage;
    private callEventInternal;
    private resetMIDIOutput;
    private recalculateStartTime;
    private sendMessage;
}

interface ExtraWaveOptions extends WaveWriteOptions {
    /**
     * The channel offset in the AudioBuffer. Defaults to 0.
     */
    channelOffset: number;
    /**
     * The amount of channels from the AudioBuffer to write. Defaults to all.
     */
    channelCount: number;
}
/**
 * Converts an audio buffer into a wave file.
 * @param audioBuffer The audio data channels.
 * @param options Additional options for writing the file.
 * @returns The binary file.
 */
declare function audioBufferToWav(audioBuffer: AudioBuffer, options?: Partial<ExtraWaveOptions>): Blob;

/**
 * Midi_handler.js
 * purpose: handles the connection between MIDI devices and synthesizer/sequencer via Web MIDI API
 */
declare class LibMIDIPort {
    readonly port: MIDIPort;
    protected constructor(port: MIDIPort);
    /**
     *
     */
    get id(): string;
    /**
     *
     */
    get name(): string | null;
    /**
     *
     */
    get manufacturer(): string | null;
    /**
     *
     */
    get version(): string | null;
}
declare class LibMIDIInput extends LibMIDIPort {
    private readonly connectedSynths;
    constructor(input: MIDIInput);
    /**
     * Connects the input to a given synth, listening for all incoming events.
     * @param synth The synth to connect to.
     */
    connect(synth: BasicSynthesizer): void;
    /**
     * Disconnects the input from a given synth.
     * @param synth The synth to disconnect from.
     */
    disconnect(synth: BasicSynthesizer): void;
}
declare class LibMIDIOutput extends LibMIDIPort {
    readonly port: MIDIOutput;
    constructor(output: MIDIOutput);
    /**
     * Connects a given sequencer to the output, playing back the MIDI file to it.
     * @param seq The sequencer to connect.
     */
    connect(seq: Sequencer): void;
    /**
     * Disconnects sequencer from the output, making it play to the attached Synthesizer instead.
     * @param seq The sequencer to disconnect.
     */
    disconnect(seq: Sequencer): void;
}
/**
 * A class for handling physical MIDI devices.
 */
declare class MIDIDeviceHandler {
    /**
     * The available MIDI inputs. ID maps to the input.
     */
    readonly inputs: Map<string, LibMIDIInput>;
    /**
     * The available MIDI outputs. ID maps to the output.
     */
    readonly outputs: Map<string, LibMIDIOutput>;
    private constructor();
    /**
     * Attempts to initialize the MIDI Device Handler.
     * @returns The handler.
     * @throws An error if the MIDI Devices fail to initialize.
     */
    static createMIDIDeviceHandler(): Promise<MIDIDeviceHandler>;
}

/**
 * Web_midi_link.js
 * purpose: handles the web midi link connection to the synthesizer
 * https://www.g200kg.com/en/docs/webmidilink/
 */
declare class WebMIDILinkHandler {
    /**
     * Initializes support for Web MIDI Link (https://www.g200kg.com/en/docs/webmidilink/)
     * @param synth The synthesizer to enable support with.
     */
    constructor(synth: BasicSynthesizer);
}

declare const DEFAULT_SYNTH_CONFIG: SynthConfig;

export { BasicSynthesizer, DEFAULT_SYNTH_CONFIG, MIDIDeviceHandler, Sequencer, WebMIDILinkHandler, WorkerSynthesizer, WorkerSynthesizerCore, WorkletSynthesizer, audioBufferToWav };
