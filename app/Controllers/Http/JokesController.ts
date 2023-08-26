import type { HttpContextContract } from '@ioc:Adonis/Core/HttpContext'
import Joke from 'App/Models/Joke';
import Rating from 'App/Models/Rating';
import Comment from 'App/Models/Comment';
import Database from '@ioc:Adonis/Lucid/Database';
import JokeValidator from 'App/Validators/JokeValidator';
import InteractionValidator from 'App/Validators/InteractionValidator';
import { DateTime } from 'luxon';

export default class JokesController {

  public static timeAgo(jokeDate) {
    const formattedJokeDate = DateTime.fromJSDate(jokeDate)
    const dateNow = DateTime.now()
    const diff = dateNow.diff(formattedJokeDate, ['days', 'hours', 'minutes'])
    
    if (diff.days > 0) {
      return `${diff.days} day${diff.days === 1 ? '' : 's'} ago`;
    } else if (diff.hours > 0) {
      return `${diff.hours} hour${diff.hours === 1 ? '' : 's'} ago`;
    } else if (diff.minutes > 0) {
      const roundedMinutes = Math.floor(diff.minutes);
      return `${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'} ago`;
    } else {
      return 'Just now';
    }
  }  

  public async index({ view, auth }: HttpContextContract) {
    const user = auth.user!

    const jokes = await Database.from('jokes')
      .join('users', 'users.id', '=', 'jokes.user_id')
      .select('jokes.*', 'users.username', 'users.image')
      .orderBy('jokes.updated_at', 'desc')
      .groupBy('jokes.id', 'users.username', 'users.image');
    
    return view.render('jokes/index', { jokes, user, timeAgo: JokesController.timeAgo })
  }

  public async create({ view }: HttpContextContract) {
    return view.render('jokes/posting')
  }

  public async store({ request, response, auth, session }: HttpContextContract) {
    const payload = await request.validate(JokeValidator)
    const user = auth.user!

    await user.related('jokes').create({
      content: payload.content
    })
    session.flash('success', 'Joke created successfully');
    return response.redirect().back()
  }

  public async show({ params }: HttpContextContract) {
    const joke = await Joke.findBy('id', params.id)

    return joke
  }

  public async edit({ view, params }: HttpContextContract) {
    const { id } = params
    const joke = await Joke.find(id)

    return view.render('jokes/edit', { joke })
  }

  public async update({ request, response, params, session }: HttpContextContract) {
    const payload = await request.validate(JokeValidator)
    
    try {
      const joke = await Joke.findOrFail(params.id);
  
      joke.content = payload.content;
      
      await joke.save();
  
      session.flash('success', 'Joke updated successfully');
    } catch (error) {
      session.flash('error', 'Joke not found or could not be updated');
    }

    return response.redirect().back()
  }

  public async destroy({ params, response, auth }: HttpContextContract) {
    const user = auth.user!
    const joke = await Joke.find(params.id)

    if(!joke) {
      return response.notFound({ message: 'Joke not found' })
    }

    if (joke.userId !== user.id) {
      return response.forbidden({ message: 'You do not have permission to delete this Joke'})
    }

    await joke.delete()

    return response.redirect().back()
  }

  public async showJoke({ view, params }: HttpContextContract) {
    const jokeId = params.id
    const joke = await Joke.find(jokeId)
    // const comments = await joke?.related('comments').query().orderBy('comments.updated_at', 'desc');
    const ratings = await joke?.related('ratings').query();

    const comments = await Database.from('comments')
      .join('users', 'users.id', '=', 'comments.user_id')
      .join('jokes', 'jokes.id', '=', 'comments.joke_id')
      .where('joke_id', jokeId)
      .select('comments.*')
      .orderBy('comments.updated_at', 'desc')
    
    const ratingsLength = ratings?.length ?? 0
    const totalRatings = ratings?.reduce((sum, rating) => sum + rating.value, 0) ?? 0
    const averageRating = ratingsLength === 0 ? 0 : totalRatings / ratingsLength;

    const ratingCounts = [0, 0, 0, 0, 0];
    ratings?.forEach(rating => {
      ratingCounts[rating.value - 1]++;
    });
    const ratingPercentages = ratingCounts.map(count => (count / ratingsLength) * 100);
    const roundedPercent = ratingPercentages.map(percentage => Math.round(percentage));
    
    return view.render('jokes/comments_ratings', {
      joke, 
      comments,
      ratingsLength, 
      averageRating,
      roundedPercent,
      timeAgo: JokesController.timeAgo
    })
  }

  public async interactions({ params, request, response, auth }: HttpContextContract) {
    try {
      const payload = await request.validate(InteractionValidator)
      const user = auth.user!
      const joke = await Joke.find(params.id)

      if(!joke) {
        return response.notFound({
          message: 'Joke not found'
        })
      }

      const existingRating = await Rating
        .query()
        .where('user_id', user.id)
        .where('joke_id', joke.id)
        .first()

      const existingComment = await Comment
        .query()
        .where('user_id', user.id)
        .where('joke_id', joke.id)
        .first()

      if(payload.rating) {
        if (existingRating) {
          existingRating.value = payload.rating
          await existingRating.save()
        } else {
          await user.related('ratings').create({
            jokeId: joke.id,
            value: payload.rating
          })
        }
      }

      if(payload.comment) {
        if (existingComment) {
          existingComment.content = payload.comment
          await existingComment.save()
        } else {
          await user.related('comments').create({
            jokeId: joke.id,
            content: payload.comment
          })
        }
      }


      return response.created({ message: 'Interactions recorded Successfully'})

    } catch (error) {
      return response.badRequest(error.messages)
    }
  }
}
