/**
 * Remotion entry point — registers all compositions for rendering.
 * Used by @remotion/bundler in the Electron main process.
 */
import { registerRoot, Composition } from 'remotion';
import { MontageComposition } from './MontageComposition';

const FPS = 30;

const Root = () => {
  return (
    <>
      <Composition
        id="Montage"
        component={MontageComposition}
        durationInFrames={30 * FPS}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{
          clips: [],
          audioUrl: null,
          audioStartTime: 0,
          words: [],
          textStyle: {},
          textOverlays: [],
          cropMode: '9:16',
        }}
      />
    </>
  );
};

registerRoot(Root);
