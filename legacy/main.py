import requests
import urllib.parse
import json
import pandas as pd
import dotenv
import os

from datetime import datetime, timedelta
from flask import Flask, redirect, request, jsonify, session, render_template

# App Configurations
app = Flask(__name__)
app.secret_key = 'a123-b234-c456'

# API Configurations
CLIENT_ID = os.getenv('CLIENT_ID')
CLIENT_SECRET = os.getenv('CLIENT_SECRET')
REDIRECT_URI = 'http://localhost:5000/callback'
AUTH_URL = 'https://accounts.spotify.com/authorize'
TOKEN_URL = 'https://accounts.spotify.com/api/token'
API_BASE_URL = 'https://api.spotify.com/v1/'

# Spotify API Functions
# Function to get the request headers(Authorization Token)
def get_headers():
    return {
        'Authorization': f"Bearer {session['access_token']}"
    }

# Function to check if token is still active
def check_token():
    if 'access_token' not in session:  # If we dont have token, redirect to login
        return redirect('/login')

    if datetime.now().timestamp() > session['expires_at']:
        return redirect('/refresh-token')
    
    return

# Function to get all tracks from a user
def get_all_tracks(offset, limit, params, first_time=True, total_tracks=999999999):
    tracks = []
    headers = get_headers()

    while offset <= total_tracks:
        response = requests.get(API_BASE_URL + 'me/tracks', headers=headers, params=params)
        response_data = response.json()

        tracks += slice_columns(response_data)

        if first_time:
            total_tracks = response_data["total"] - limit
            first_time = False
        
        offset = offset + limit
        params['offset'] = offset
        app.logger.info(offset)  # LOG
    
    return tracks


# Helper function to get the genre of a songs based on the album and the artists (OLD)
def get_track_genre(album_id, artists_id):
    global album_genre_cache
    global artist_genre_cache

    app.logger.info(album_id)  # LOG

    headers = get_headers()

    if album_id in album_genre_cache:
        return album_genre_cache[album_id]

    response = requests.get(API_BASE_URL + f'albums/{album_id}', headers=headers)
    response_data = response.json()
    genres = response_data['genres']

    if not genres:
        app.logger.info(artists_id)  # LOG

        for artist_id in artists_id:
            if artist_id in artist_genre_cache:
                return artist_genre_cache[album_id]
            
            response = requests.get(API_BASE_URL + f'artists/{artist_id}', headers=headers)
            response_data = response.json()
            genres = genres + response_data['genres']
            artist_genre_cache[artist_id] = genres
        
    album_genre_cache[album_id] = genres
    return genres

# Function to get the user id
def get_user_id():
    check_token()
    headers = get_headers()
    response = requests.get(API_BASE_URL + 'me', headers=headers)
    response_data = response.json()
    id = response_data['id']
    return id


# Logic Functions
# Helper Function to clean the response with only the necessary columns
def slice_columns(response):
    tracks_dict_list = []
    tracks_items = response['items']
    [tracks_dict_list.append(get_track_atributes(item)) for item in tracks_items]
    return tracks_dict_list

# Helper function to get the necesary attributes of a song
def get_track_atributes(items):
    flat_file = {}

    track = items['track']
    album = track['album']
    artists = track['artists']

    flat_file['track_name'] = track['name']
    flat_file['track_id'] = track['id']
    flat_file['artist_id'] = artists[0]['id']
    flat_file['artist_name'] = artists[0]['name']
    
    return flat_file

def get_chunk(list_, n=20):
    for i in range(0, len(list_), n):
        yield list_[i:i + n]


# Home Page
@app.route('/')
def index():
    return "Welcome to my Spotify App <a href='/login'> Login with Spotify</a>"


# End Point: Redirect to Spotify login page 
#   make a request with users credentials and get the token
@app.route('/login')
def login():
    scope = 'user-read-private user-read-email user-library-read playlist-modify-public playlist-modify-private'   # Store scopes to access the API
    params = {
        'client_id': CLIENT_ID,
        'response_type': 'code',
        'scope': scope,
        'redirect_uri': REDIRECT_URI,
        'show_dialog': True
    }

    # Make a get request to the AUTH URL with the params dictionary encoded
    auth_url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    
    return redirect(auth_url)

# Endpoint: Create the callback that Spotify is going to redirect
@app.route('/callback')
def callback():
    if 'error' in request.args:
        return jsonify({"error": request.args['error']})
    
    if 'code' in request.args:
        req_body = {
            'code': request.args['code'],
            'grant_type': 'authorization_code',
            'redirect_uri': REDIRECT_URI,
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET
        }

        response = requests.post(TOKEN_URL, data=req_body)  # Make request with user credentials
        token_info = response.json()

        session['access_token'] = token_info['access_token']
        session['refresh_token'] = token_info['refresh_token']
        session['expires_at'] = datetime.now().timestamp() + token_info['expires_in']

        return redirect('/menu')

# Endpoint: Display the availabale app options
@app.route('/menu')
def options_menu():
    return "What would you like to do? <br>\
            <a href='/playlists'>  Get playlists</a> <br>\
            <a href='/liked-songs'> Get songs</a><br>\
            <a href='/get-genre'> Get songs genre</a><br>\
            <a href='/create-playlists'> Create playlists based on genre</a><br>\
            <a href='/test'> Test current function</a><br>"

# Endpoint: Retrieve users playlists
@app.route('/playlists')
def get_playlists():
    check_token()

    headers = get_headers()


    response = requests.get(API_BASE_URL + 'me/playlists', headers=headers)
    playlists = response.json()

    return jsonify(playlists)

# Endpoint: Refresh access token
@app.route('/refresh-token')
def refresh_token():
    if 'refresh_token' not in session:
        return redirect('/login')
    
    if datetime.now().timestamp() > session['expires_at']:
        req_body = {
            'grant_type': 'refresh_token',
            'refresh_token': session['refresh_token'],
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET
        }

        response = requests.post(TOKEN_URL, data=req_body)
        new_token_info = response.json()

        session['access_token'] = new_token_info['access_token']
        session['expires_at'] = datetime.now().timestamp() + new_token_info['expires_in']

        return redirect('/playlists')

# Endpoint: Gett user liked songs
@app.route('/liked-songs')
def get_liked_songs():
    check_token()

    offset = 0
    limit = 50
    params = {
        'limit': limit,
        'offset': offset
    }
    
    #tracks_data = get_all_tracks(offset, limit, params)
    tracks_data = get_all_tracks(offset, limit, params, first_time=False, total_tracks=1)
    
    songs_data = pd.DataFrame(tracks_data)
    songs_data.to_csv('data.csv', index=False)

    return f'success we recovered {len(tracks_data)} songs'

# Endpoint: Create playlists by users songs genres
@app.route('/get-genre')
def get_songs_genre():
    check_token()
    
    file1 = open('artist_genre.json')
    artist_genre_cache = json.load(file1)

    songs = pd.read_csv('data.csv')

    # TRY getting by artists
    unique_artists = songs['artists_id'].unique()  # Get unique artists
    not_in_cache = [artist for artist in unique_artists if artist not in artist_genre_cache]  # Get artists that we dont have already

    app.logger.info(len(not_in_cache))  # LOG

    for artists in get_chunk(not_in_cache, 50):
        # Make request
        artists_ids = ','.join(map(str, artists))
        headers = get_headers()

        response = requests.get(API_BASE_URL + f'artists?ids={artists_ids}', headers=headers)
        response_data = response.json()
        for artist in response_data['artists']:
            artist_genre_cache[artist['id']] = artist['genres']  # Update artists cache

    with open("artists_genre.json", "w") as outfile: 
        json.dump(artist_genre_cache, outfile)

    songs['genres'] = songs['artists_id'].apply(lambda x: artist_genre_cache.get(x))
    songs.to_csv('data2.csv', index=False)
    songs = songs[['track_id', 'genres']]
    songs = songs.explode('genres')
    unique_songs_genres = songs.drop_duplicates(subset=['track_id', 'genres'])
    songs.to_csv('songs_genre.csv', index=False)


    return "We succesfully get your songs genre"

@app.route('/create-playlists')
def create_playlists():
    # songs_genres = pd.read_csv('songs_genre.csv')
    # songs_genres.sort_values('genres')
    # unique_genres = songs_genres['genres'].unique()
    # headers = get_headers()
    # grouped = songs_genres.groupby('genres')['track_id'].apply(list)
    # genre_chunks = {
    #     genre: [
    #         ','.join(f'spotify%3Atrack%3A{song_id}' for song_id in song_ids[i:i+100])
    #         for i in range(0, len(song_ids), 100)
    #     ]
    #     for genre, song_ids in grouped.items()
    # }


    # id = get_user_id()

    # for genre, chunks in genre_chunks.items():
    #     data = {
    #         'name': f'My {genre} Playlist',
    #         'description': '',
    #         'public': False
    #     }

    #     response = requests.post(API_BASE_URL + f'users/{id}/playlists', headers=headers, json=data)
    #     response_data = response.json()
    #     playlist_id = response_data['id']

    #     for chunk_number, chunk in enumerate(chunks, start=1):
    #         data = {
    #             'uris': chunk,
    #             'position': 0
    #         }
    #         response = requests.post(API_BASE_URL + f'playlists/{playlist_id}/tracks', headers, json=data)
        
    return 'test'

@app.route('/test')
def test():
    # check_token()
    # offset = 0
    # limit = 50
    # params = {
    #     'limit': limit,
    #     'offset': offset
    # }
    # data = get_all_tracks(offset, limit, params, first_time=False, total_tracks=2)
    # ids = [track["track_id"] for track in data]
    
    # audio_features = get_tracks_audio_features(ids)

    # songs_data = pd.DataFrame(data)
    # songs_features = pd.DataFrame(audio_features)

    # songs = pd.merge(songs_data, songs_features, left_on='track_id', right_on='id', how='left')
    # df_html = songs.to_html(classes='table table-striped', index=False)

    # songs.to_csv('data.csv', index=False)
    
    # # Create a simple HTML page to display the DataFrame
    # html = f"""
    # <!DOCTYPE html>
    # <html lang="en">
    # <head>
    #     <meta charset="UTF-8">
    #     <meta name="viewport" content="width=device-width, initial-scale=1.0">
    #     <title>DataFrame Display</title>
    #     <!-- Add Bootstrap for styling (optional) -->
    #     <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">
    # </head>
    # <body>
    #     <div class="container">
    #         <h1>DataFrame Display</h1>
    #         {df_html}
    #     </div>
    # </body>
    # </html>
    # """

    # return html
    #get_tracks_audio_features(data)
    return "test"

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True)